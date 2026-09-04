import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { activityMember, member } from "../member/schema";
import {
  checkDemandsLinkable,
  demandFields,
  lockWritableSegment,
  replaceDemandLinks,
  replaceSegmentDemands,
  resourceFields,
} from "./demands";
import {
  activityResource,
  deriveDemandStatus,
  resourceDemandLink,
  resourceMemberBinding,
  segmentResourceDemand,
} from "./schema";
import {
  activeResourceCount,
  boundMemberCount,
  linkedDemandCount,
  resourceMemberCount,
} from "./stats";
import {
  BindResourceMembersInput,
  CreateResourceInput,
  ListDemandsInput,
  ListResourcesInput,
  ResourceIdInput,
  ResourceStatsInput,
  SaveSegmentDemandsInput,
  SetResourceStatusInput,
  UnbindResourceMemberInput,
  UpdateResourceInput,
} from "./validation";

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

const notFound = (what: string) =>
  err({ code: "NOT_FOUND" as const, message: `${what}不存在` });

// ---------------------------------------------------------------------------
// 环节资源需求项
// ---------------------------------------------------------------------------

export const resourceDemandRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 一个活动的全部需求项，一次全量返回，不分页——理由见 validation.ts 的
   * ListDemandsInput。
   *
   * 连带返回环节的名称、时间和状态：汇总页要按环节展示和排序，议程页要按
   * 环节分组画 chip，两边都需要，各自再查一次环节纯属浪费。
   *
   * 作废环节的需求项**照常返回**，由视图自己过滤（同 agenda/list 的口径）。
   * 汇总页默认不把它们算进待办——环节都作废了，它的用车需求不该再催人配。
   */
  .post("/list", jsonBody(ListDemandsInput), async (c) => {
    const { activityId } = c.req.valid("json");

    const rows = await db
      .select({
        ...demandFields,
        segmentName: activitySegment.name,
        segmentStatus: activitySegment.status,
        segmentStartTime: activitySegment.startTime,
        segmentEndTime: activitySegment.endTime,
        activeResourceCount,
        boundMemberCount,
      })
      .from(segmentResourceDemand)
      .innerJoin(
        activitySegment,
        eq(activitySegment.id, segmentResourceDemand.segmentId),
      )
      .where(eq(segmentResourceDemand.activityId, activityId))
      // 按环节在议程上的先后排，同一环节内按 id 稳定排列。
      .orderBy(
        asc(activitySegment.startTime),
        asc(activitySegment.id),
        asc(segmentResourceDemand.id),
      );

    return c.json(
      ok({
        list: rows.map((row) => ({
          ...row,
          status: deriveDemandStatus(row),
        })),
      }),
    );
  })

  /**
   * 整体替换一个环节的需求项集合。传进来的 upsert，没传的删除。
   *
   * 全程一个事务：弹窗里"取消用车、新增用餐、改住宿说明"是一次提交，中途
   * 失败必须整体回退，不能留下"用车删了但用餐没建"的半保存状态。
   */
  .post("/saveForSegment", jsonBody(SaveSegmentDemandsInput), async (c) => {
    const { segmentId, demands } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      // activityId 不从入参取——它必须等于环节自己的 activity_id，
      // 让前端传等于给了它传错的机会（表上的复合外键会挡住，但报出来是
      // 一条 Postgres 约束错误）。
      //
      // 前端已经把作废行的"资源需求"按钮藏掉了，lockWritableSegment 里再挡
      // 一次：UI 只是不给入口，不是约束。
      const segment = await lockWritableSegment(tx, segmentId);
      if (!segment.ok) {
        return segment.message === null
          ? { kind: "notFound" as const }
          : { kind: "invalid" as const, message: segment.message };
      }

      const rows = await replaceSegmentDemands(tx, {
        segmentId,
        activityId: segment.activityId,
        demands,
        userId,
      });

      return { kind: "ok" as const, rows };
    });

    if (result.kind === "notFound") return c.json(notFound("环节"));
    if (result.kind === "invalid")
      return c.json(validationError(result.message));
    return c.json(ok({ list: result.rows }));
  });

// ---------------------------------------------------------------------------
// 活动级资源台账
// ---------------------------------------------------------------------------

export const activityResourceRoutes = new Hono<{
  Variables: AuthedVariables;
}>()
  .use(requireUser)

  .post("/list", jsonBody(ListResourcesInput), async (c) => {
    const {
      activityId,
      resourceType,
      transportScene,
      status,
      keyword,
      demandId,
      ...page
    } = c.req.valid("json");

    const keywordFilter = keyword
      ? or(
          ilike(activityResource.name, `%${keyword}%`),
          ilike(activityResource.location, `%${keyword}%`),
          ilike(activityResource.vehicleInfo, `%${keyword}%`),
          ilike(activityResource.driverName, `%${keyword}%`),
        )
      : undefined;

    const where = and(
      eq(activityResource.activityId, activityId),
      resourceType
        ? eq(activityResource.resourceType, resourceType)
        : undefined,
      transportScene
        ? eq(activityResource.transportScene, transportScene)
        : undefined,
      status ? eq(activityResource.status, status) : undefined,
      keywordFilter,
      // 从需求汇总页"查看安排"点进来时带上，只看这条需求关联的资源。
      //
      // 同样走查询构造器而不是手写 sql 模板。WHERE 语境下 drizzle 其实会
      // 正确限定表名（只有 `.select()` 字段语境不会，见上面 scalarCount 的
      // 注释），但在同一个文件里留一份"看着一样、行为不一样"的写法，就是在
      // 等下一个人照着抄错的那半边。
      demandId
        ? exists(
            db
              .select({ n: sql`1` })
              .from(resourceDemandLink)
              .where(
                and(
                  eq(resourceDemandLink.resourceId, activityResource.id),
                  eq(resourceDemandLink.demandId, demandId),
                ),
              ),
          )
        : undefined,
    );

    const [list, [total]] = await Promise.all([
      db
        .select({
          ...resourceFields,
          linkedDemandCount,
          boundMemberCount: resourceMemberCount,
        })
        .from(activityResource)
        .where(where)
        // id DESC 而不是 updatedAt DESC：按更新时间排的话，编辑或作废会把
        // 那一行弹到第一位，用户点第三行、那行立刻跳走。
        .orderBy(desc(activityResource.id))
        .limit(toLimitOffset(page).limit)
        .offset(toLimitOffset(page).offset),
      db.select({ total: count() }).from(activityResource).where(where),
    ]);

    return c.json(ok({ list, total: total?.total ?? 0 }));
  })

  /** 详情：资源本身 + 关联的需求项 + 已绑定的人员。 */
  .post("/get", jsonBody(ResourceIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const [row] = await db
      .select(resourceFields)
      .from(activityResource)
      .where(eq(activityResource.id, id));

    if (!row) return c.json(notFound("资源记录"));

    const [demands, members] = await Promise.all([
      db
        .select({
          id: segmentResourceDemand.id,
          resourceType: segmentResourceDemand.resourceType,
          handling: segmentResourceDemand.handling,
          description: segmentResourceDemand.description,
          segmentId: segmentResourceDemand.segmentId,
          segmentName: activitySegment.name,
          segmentStartTime: activitySegment.startTime,
        })
        .from(resourceDemandLink)
        .innerJoin(
          segmentResourceDemand,
          eq(segmentResourceDemand.id, resourceDemandLink.demandId),
        )
        .innerJoin(
          activitySegment,
          eq(activitySegment.id, segmentResourceDemand.segmentId),
        )
        .where(eq(resourceDemandLink.resourceId, id))
        .orderBy(asc(activitySegment.startTime)),

      db
        .select({
          id: resourceMemberBinding.id,
          activityMemberId: resourceMemberBinding.activityMemberId,
          memberId: resourceMemberBinding.memberId,
          name: member.name,
          mobile: member.mobile,
          companyPosition: member.companyPosition,
          groupName: activityMember.groupName,
        })
        .from(resourceMemberBinding)
        .innerJoin(member, eq(member.id, resourceMemberBinding.memberId))
        .innerJoin(
          activityMember,
          eq(activityMember.id, resourceMemberBinding.activityMemberId),
        )
        .where(eq(resourceMemberBinding.resourceId, id))
        .orderBy(asc(resourceMemberBinding.id)),
    ]);

    return c.json(ok({ ...row, demands, members }));
  })

  .post("/create", jsonBody(CreateResourceInput), async (c) => {
    const { activityId, demandIds, ...input } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(
      async (
        tx,
      ): Promise<
        { kind: "ok"; id: number } | { kind: "invalid"; message: string }
      > => {
        const problem = await checkDemandsLinkable(
          tx,
          activityId,
          input.resourceType,
          demandIds,
        );
        if (problem) return { kind: "invalid", message: problem };

        const [row] = await tx
          .insert(activityResource)
          .values({
            ...input,
            activityId,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning({ id: activityResource.id });

        await replaceDemandLinks(tx, row.id, activityId, demandIds, userId);

        return { kind: "ok", id: row.id };
      },
    );

    if (result.kind === "invalid") {
      return c.json(validationError(result.message));
    }
    return c.json(ok({ id: result.id }));
  })

  .post("/update", jsonBody(UpdateResourceInput), async (c) => {
    const { id, demandIds, ...input } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(
      async (
        tx,
      ): Promise<
        | { kind: "ok"; row: typeof activityResource.$inferSelect }
        | { kind: "notFound" }
        | { kind: "invalid"; message: string }
      > => {
        /**
         * 这里**必须先 SELECT 再 UPDATE**，不能用 `UPDATE ... RETURNING` 一把
         * 梭（其他模块的常规写法是后者，这是个有理由的例外）：
         *
         * 关联校验需要知道这条资源属于哪个活动，而 activityId 不在入参里
         * （资源不支持改挂活动）。先 UPDATE 拿到 activityId 再校验的话，校验
         * 失败时事务已经把字段改完了——而这个 handler 是**返回**错误而不是抛
         * 异常，drizzle 于是照常提交。结果就是：用户看到一句"资源类型与所选
         * 需求不一致"，但名称、时间、车辆已经改掉了，关联却没换。
         *
         * `.for("update")` 顺带锁住这一行，避免两个并发编辑交叉写。
         */
        const [existing] = await tx
          .select({ activityId: activityResource.activityId })
          .from(activityResource)
          .where(eq(activityResource.id, id))
          .for("update");

        if (!existing) return { kind: "notFound" };

        const problem = await checkDemandsLinkable(
          tx,
          existing.activityId,
          input.resourceType,
          demandIds,
        );
        if (problem) return { kind: "invalid", message: problem };

        const [row] = await tx
          .update(activityResource)
          .set({ ...input, updatedBy: userId })
          .where(eq(activityResource.id, id))
          .returning();

        await replaceDemandLinks(
          tx,
          id,
          existing.activityId,
          demandIds,
          userId,
        );

        return { kind: "ok", row };
      },
    );

    if (result.kind === "notFound") return c.json(notFound("资源记录"));
    if (result.kind === "invalid")
      return c.json(validationError(result.message));
    return c.json(ok({ id: result.row.id }));
  })

  /**
   * 作废/恢复。**不需要动任何需求项的状态**——需求项的配置状态是现算的，
   * 作废之后下一次查询自然就从"已配置"退回"待配置"了。
   */
  .post("/setStatus", jsonBody(SetResourceStatusInput), async (c) => {
    const { id, status } = c.req.valid("json");

    const [row] = await db
      .update(activityResource)
      .set({ status, updatedBy: c.get("authedUser").id })
      .where(eq(activityResource.id, id))
      .returning({ id: activityResource.id });

    return row ? c.json(ok(row)) : c.json(notFound("资源记录"));
  })

  /**
   * 概览统计。列表是分页的，所以统计必须单独开接口，而且**不带筛选条件**
   * ——数字跟着筛选变的话，用户每改一次筛选顶部就跳一次，没法当参照系。
   *
   * 一条 SQL 用 filter 子句把五个计数一起取回，不要每个数字发一次请求。
   */
  .post("/stats", jsonBody(ResourceStatsInput), async (c) => {
    const { activityId } = c.req.valid("json");

    const [row] = await db
      .select({
        transport: sql<number>`(count(*) filter (where ${activityResource.resourceType} = 'transport' and ${activityResource.status} = 'active'))::int`,
        dining: sql<number>`(count(*) filter (where ${activityResource.resourceType} = 'dining' and ${activityResource.status} = 'active'))::int`,
        accommodation: sql<number>`(count(*) filter (where ${activityResource.resourceType} = 'accommodation' and ${activityResource.status} = 'active'))::int`,
        material: sql<number>`(count(*) filter (where ${activityResource.resourceType} = 'material' and ${activityResource.status} = 'active'))::int`,
        voided: sql<number>`(count(*) filter (where ${activityResource.status} = 'voided'))::int`,
      })
      .from(activityResource)
      .where(eq(activityResource.activityId, activityId));

    return c.json(
      ok(
        row ?? {
          transport: 0,
          dining: 0,
          accommodation: 0,
          material: 0,
          voided: 0,
        },
      ),
    );
  })

  // -------------------------------------------------------------- 人员绑定 --

  /**
   * 绑定服务名单。入参是主档 memberId，服务端换成活动人员关系 id。
   *
   * 换不到就说明这个人不在本活动人员库里 —— BR-DEV-033A 要求绑定对象必须
   * 来自活动人员关系，这里是那条规则真正生效的地方（表上的复合外键是最后
   * 一道，但它只会给出一条约束错误）。
   */
  .post("/bindMembers", jsonBody(BindResourceMembersInput), async (c) => {
    const { resourceId, memberIds } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const [resource] = await db
      .select({
        activityId: activityResource.activityId,
        resourceType: activityResource.resourceType,
        status: activityResource.status,
      })
      .from(activityResource)
      .where(eq(activityResource.id, resourceId));

    if (!resource) return c.json(notFound("资源记录"));

    // 物料是活动通用型资源，不绑人（BR-DEV-033A）。挡在这里而不是让它存进去：
    // 存进去的绑定既不参与配置状态判定（deriveDemandStatus 对物料不看绑定数），
    // 台账页也不会展示，是一份查不到、用不上、还会在导出时冒出来的数据。
    if (resource.resourceType === "material") {
      return c.json(validationError("物料记录不绑定人员"));
    }

    if (resource.status === "voided") {
      return c.json(validationError("已作废的资源记录不能再绑定人员"));
    }

    const relations = await db
      .select({ id: activityMember.id, memberId: activityMember.memberId })
      .from(activityMember)
      .where(
        and(
          eq(activityMember.activityId, resource.activityId),
          inArray(activityMember.memberId, [...memberIds]),
        ),
      );

    if (relations.length !== memberIds.length) {
      return c.json(
        validationError("所选人员中有人不在本活动人员库，请先加入活动人员"),
      );
    }

    // 重复绑定不报错：并发点两下、或者名单里混进了已绑的人，都应该是幂等的。
    await db
      .insert(resourceMemberBinding)
      .values(
        relations.map((relation) => ({
          resourceId,
          activityId: resource.activityId,
          activityMemberId: relation.id,
          memberId: relation.memberId,
          createdBy: userId,
        })),
      )
      .onConflictDoNothing();

    return c.json(ok({ bound: relations.length }));
  })

  .post("/unbindMember", jsonBody(UnbindResourceMemberInput), async (c) => {
    const { id } = c.req.valid("json");

    const [row] = await db
      .delete(resourceMemberBinding)
      .where(eq(resourceMemberBinding.id, id))
      .returning({ id: resourceMemberBinding.id });

    return row ? c.json(ok(row)) : c.json(notFound("绑定记录"));
  });
