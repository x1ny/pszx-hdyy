import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  notInArray,
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
  activityResource,
  deriveDemandStatus,
  resourceDemandLink,
  resourceMemberBinding,
  RESOURCE_TYPE_LABELS,
  segmentResourceDemand,
  type ResourceType,
} from "./schema";
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

/** 事务句柄。drizzle 没导出这个类型，从 db.transaction 的回调参数上取。 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

const notFound = (what: string) =>
  err({ code: "NOT_FOUND" as const, message: `${what}不存在` });

// ---------------------------------------------------------------------------
// 派生计数
// ---------------------------------------------------------------------------

/**
 * 相关子查询一律用 drizzle 的查询构造器拼，**不要手写 sql 模板**。
 *
 * 踩过一次，代价很大：手写 `` sql`... where dl.resource_id = ${activityResource.id}` ``
 * 时，drizzle 把列渲染成**不带表名的 `"id"`**（`.select()` 里的列是"选择字段"
 * 语境，它省掉了限定符）。于是子查询里那个裸 `"id"` 按 SQL 的作用域规则绑到了
 * 子查询自己的表上——条件变成 `dl.resource_id = dl.id`，恒假，计数恒为 0。
 *
 * 最坏的地方是它**不报错**：SQL 合法、接口 200、列表照常渲染，只是每一行的
 * 关联数都是 0。手写 SQL 单测时反而是对的（那里会老老实实写 `d.id`），只有
 * 走真实页面才看得出来。
 *
 * `eq(a, b)` 传两个 Column 时两边都会带表名限定，所以查询构造器版本天然正确。
 * `.mapWith(Number)` 是必须的：count 返回 bigint，node-postgres 给回字符串，
 * 而这个值要参与 deriveDemandStatus 里的 `=== 0` 比较。
 */
const scalarCount = (
  query: { getSQL: () => ReturnType<typeof sql> } | ReturnType<typeof sql>,
) => sql<number>`(${query})`.mapWith(Number);

/**
 * 一条需求项关联了几条**正常**的资源记录。
 *
 * 作废的资源不计入：两辆车都作废了，需求就该退回"待配置"。这正是把状态做成
 * 派生量换来的东西——作废接口里一行回写代码都不用写。
 */
const activeResourceCount = scalarCount(
  db
    .select({ n: count() })
    .from(resourceDemandLink)
    .innerJoin(
      activityResource,
      and(
        eq(activityResource.id, resourceDemandLink.resourceId),
        eq(activityResource.status, "active"),
      ),
    )
    .where(eq(resourceDemandLink.demandId, segmentResourceDemand.id)),
);

/** 这条需求关联的正常资源上，一共绑了多少人次。 */
const boundMemberCount = scalarCount(
  db
    .select({ n: count() })
    .from(resourceDemandLink)
    .innerJoin(
      activityResource,
      and(
        eq(activityResource.id, resourceDemandLink.resourceId),
        eq(activityResource.status, "active"),
      ),
    )
    .innerJoin(
      resourceMemberBinding,
      eq(resourceMemberBinding.resourceId, activityResource.id),
    )
    .where(eq(resourceDemandLink.demandId, segmentResourceDemand.id)),
);

/** 一条资源记录被几条需求项引用。 */
const linkedDemandCount = scalarCount(
  db
    .select({ n: count() })
    .from(resourceDemandLink)
    .where(eq(resourceDemandLink.resourceId, activityResource.id)),
);

/** 一条资源记录绑了几个人。 */
const resourceMemberCount = scalarCount(
  db
    .select({ n: count() })
    .from(resourceMemberBinding)
    .where(eq(resourceMemberBinding.resourceId, activityResource.id)),
);

// ---------------------------------------------------------------------------
// 环节资源需求项
// ---------------------------------------------------------------------------

const demandFields = {
  id: segmentResourceDemand.id,
  activityId: segmentResourceDemand.activityId,
  segmentId: segmentResourceDemand.segmentId,
  resourceType: segmentResourceDemand.resourceType,
  handling: segmentResourceDemand.handling,
  description: segmentResourceDemand.description,
  estimatedCount: segmentResourceDemand.estimatedCount,
  ownerName: segmentResourceDemand.ownerName,
};

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
      const [segment] = await tx
        .select({
          activityId: activitySegment.activityId,
          status: activitySegment.status,
        })
        .from(activitySegment)
        .where(eq(activitySegment.id, segmentId))
        // 锁住环节这一行：整体替换是"先删后插"，两个并发请求交叉执行会
        // 互相删掉对方刚插入的行。锁在环节粒度，不同环节互不阻塞。
        .for("update");

      if (!segment) return { kind: "notFound" as const };

      // 作废环节不再接受新的资源需求声明。文档 §8.2 对环节作废的定义是
      // "不再进入新排位"，同一口径下也不该再产生新的资源待办——它的需求项
      // 本来就被 isOpenTodo 过滤在待办之外，改了也是死数据。
      //
      // 前端已经把作废行的"资源需求"按钮藏掉了，这里再挡一次：UI 只是不给
      // 入口，不是约束。
      if (segment.status === "voided") {
        return {
          kind: "invalid" as const,
          message: "环节已作废，不能再维护它的资源需求",
        };
      }

      const keepTypes = demands.map((d) => d.resourceType);

      // 先删：本次没提交的类型 = 用户在弹窗里关掉的需求。
      // link 表上 fk_link_demand_activity 带 cascade，关联关系跟着走。
      await tx.delete(segmentResourceDemand).where(
        and(
          eq(segmentResourceDemand.segmentId, segmentId),
          keepTypes.length > 0
            ? notInArray(segmentResourceDemand.resourceType, keepTypes)
            : undefined,
        ),
      );

      if (demands.length === 0) return { kind: "ok" as const, rows: [] };

      // 再 upsert。冲突键就是矩阵那条唯一约束——重复保存同一个环节时走更新，
      // 不会因为"已经有一条用车需求"而报错。
      const rows = await tx
        .insert(segmentResourceDemand)
        .values(
          demands.map((d) => ({
            ...d,
            segmentId,
            activityId: segment.activityId,
            createdBy: userId,
            updatedBy: userId,
          })),
        )
        .onConflictDoUpdate({
          target: [
            segmentResourceDemand.segmentId,
            segmentResourceDemand.resourceType,
          ],
          set: {
            handling: sql`excluded.handling`,
            description: sql`excluded.description`,
            estimatedCount: sql`excluded.estimated_count`,
            ownerName: sql`excluded.owner_name`,
            updatedBy: userId,
            updatedAt: new Date(),
          },
        })
        .returning(demandFields);

      return { kind: "ok" as const, rows };
    });

    if (result.kind === "notFound") return c.json(notFound("环节"));
    if (result.kind === "invalid") return c.json(validationError(result.message));
    return c.json(ok({ list: result.rows }));
  });

// ---------------------------------------------------------------------------
// 活动级资源台账
// ---------------------------------------------------------------------------

const resourceFields = {
  id: activityResource.id,
  activityId: activityResource.activityId,
  resourceType: activityResource.resourceType,
  transportScene: activityResource.transportScene,
  name: activityResource.name,
  quantity: activityResource.quantity,
  startTime: activityResource.startTime,
  endTime: activityResource.endTime,
  location: activityResource.location,
  vehicleInfo: activityResource.vehicleInfo,
  driverName: activityResource.driverName,
  driverPhone: activityResource.driverPhone,
  ownerName: activityResource.ownerName,
  remark: activityResource.remark,
  status: activityResource.status,
  createdAt: activityResource.createdAt,
  updatedAt: activityResource.updatedAt,
};

/**
 * 校验这批需求项可以被这条资源满足。三件事一起查：
 *
 * 1. **同属一个活动**。表上的复合外键已经保证了这点，但违反时抛的是一条
 *    Postgres 约束错误，会穿过 index.ts 的 onError 变成 500——用户看到
 *    "服务器内部错误"，而这本该是一句人话。
 * 2. **资源类型一致**。一条"用车"需求只能由用车记录满足。不校验的话，把一条
 *    物料记录关联到用车需求上，那条需求立刻变成"已配置"——完整性检查报的是
 *    绿灯，实际那个环节的车根本没人管。这是最隐蔽的一种脏数据：状态是对的
 *    形状，内容是错的。
 * 3. **处理要求必须是"落实安排"**。`record_only` 按定义就不产生台账记录，
 *    deriveDemandStatus 对它连关联数都不看，硬关联上去只会攒出一份查不到、
 *    用不上的死数据。
 *
 * **必须在任何写入之前调用**——`/update` 曾经把它放在 UPDATE 之后，校验失败
 * 时事务照常提交，用户收到一句错误提示，但名称、时间、车辆已经改掉了，
 * 而关联没换。半提交比彻底失败更难查。
 */
async function checkDemandsLinkable(
  tx: Tx,
  activityId: number,
  resourceType: ResourceType,
  demandIds: readonly number[],
): Promise<string | null> {
  if (demandIds.length === 0) return null;

  const rows = await tx
    .select({
      id: segmentResourceDemand.id,
      resourceType: segmentResourceDemand.resourceType,
      handling: segmentResourceDemand.handling,
    })
    .from(segmentResourceDemand)
    .where(
      and(
        inArray(segmentResourceDemand.id, [...demandIds]),
        eq(segmentResourceDemand.activityId, activityId),
      ),
    );

  if (rows.length !== demandIds.length) {
    return "所选的环节资源需求不存在或不属于当前活动";
  }

  const mismatched = rows.find((row) => row.resourceType !== resourceType);
  if (mismatched) {
    return `资源类型与所选需求不一致：该需求要的是${RESOURCE_TYPE_LABELS[mismatched.resourceType]}`;
  }

  const recordOnly = rows.find((row) => row.handling !== "arrange");
  if (recordOnly) {
    return "处理要求为「仅记录需求」的需求项不需要关联资源记录";
  }

  return null;
}

/** 整体替换一条资源记录关联的需求项。调用前须已通过 checkDemandsBelong。 */
async function replaceDemandLinks(
  tx: Tx,
  resourceId: number,
  activityId: number,
  demandIds: readonly number[],
  userId: string,
) {
  await tx
    .delete(resourceDemandLink)
    .where(eq(resourceDemandLink.resourceId, resourceId));

  if (demandIds.length === 0) return;

  await tx.insert(resourceDemandLink).values(
    demandIds.map((demandId) => ({
      demandId,
      resourceId,
      activityId,
      createdBy: userId,
    })),
  );
}

export const activityResourceRoutes = new Hono<{
  Variables: AuthedVariables;
}>()
  .use(requireUser)

  .post("/list", jsonBody(ListResourcesInput), async (c) => {
    const { activityId, resourceType, transportScene, status, keyword, demandId, ...page } =
      c.req.valid("json");

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
      resourceType ? eq(activityResource.resourceType, resourceType) : undefined,
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
        .select({ ...resourceFields, linkedDemandCount, boundMemberCount: resourceMemberCount })
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

        await replaceDemandLinks(tx, id, existing.activityId, demandIds, userId);

        return { kind: "ok", row };
      },
    );

    if (result.kind === "notFound") return c.json(notFound("资源记录"));
    if (result.kind === "invalid") return c.json(validationError(result.message));
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
