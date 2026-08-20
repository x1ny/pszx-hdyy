import { and, asc, count, eq, ilike, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { activity } from "../project/schema";
import { activityResource, resourceMemberBinding } from "../resource/schema";
import {
  createMemberInTx,
  ensureActivityMembers,
  ensureProjectMembers,
  ensureSegmentMembers,
  MemberLadderError,
} from "./ladder";
import {
  activityMember,
  member,
  projectMember,
  segmentMember,
} from "./schema";
import {
  AddActivityMembersInput,
  AddNewActivityMemberInput,
  AddNewProjectMemberInput,
  AddNewSegmentMemberInput,
  AddProjectMembersInput,
  AddSegmentMembersInput,
  ListActivityMembersInput,
  ListProjectMembersInput,
  ListSegmentMembersInput,
  RelationIdInput,
  RemoveActivityMemberInput,
  UpdateActivityMemberInput,
  UpdateProjectMemberInput,
  UpdateSegmentMemberInput,
} from "./validation";

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

const notFound = (what: string) =>
  err({ code: "NOT_FOUND" as const, message: `${what}不存在` });

/**
 * ladder 抛出的业务失败翻译成统一信封。ladder 用 throw 而不是返回结果对象，
 * 是因为它整个跑在事务里——throw 顺带就是回滚，返回错误还得让每个调用方
 * 记得自己 rollback。
 */
async function runLadder<T>(
  work: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (error instanceof MemberLadderError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/** 三层列表都要带出来的人员身份列。关系表自己不存这些，一律 join 主档。 */
const identityFields = {
  memberId: member.id,
  name: member.name,
  gender: member.gender,
  companyPosition: member.companyPosition,
  mobile: member.mobile,
  idType: member.idType,
  idNumber: member.idNumber,
  memberStatus: member.status,
};

// ---------------------------------------------------------------------------
// 项目人员
// ---------------------------------------------------------------------------

export const projectMemberRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListProjectMembersInput), async (c) => {
    const { projectId, name, companyPosition, page, pageSize } =
      c.req.valid("json");

    const where = and(
      eq(projectMember.projectId, projectId),
      name ? ilike(member.name, `%${name}%`) : undefined,
      companyPosition
        ? ilike(member.companyPosition, `%${companyPosition}%`)
        : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select({
          id: projectMember.id,
          ...identityFields,
          sourceType: projectMember.sourceType,
          remark: projectMember.remark,
          createdAt: projectMember.createdAt,

          // 文档 8.1.1 给项目人员列了"关联活动数""最近参与活动"两个字段。
          // 它们是派生值，没有物化——见 schema.ts 里 project_member 的说明。
          // 这两句相关子查询就是那个决定的兑现处。
          activityCount: sql<number>`(
            select count(*)::int from ${activityMember}
            where ${eq(activityMember.projectMemberId, projectMember.id)}
          )`.as("activity_count"),
          latestActivityName: sql<string | null>`(
            select ${activity.name} from ${activityMember}
            join ${activity} on ${activity.id} = ${activityMember.activityId}
            where ${eq(activityMember.projectMemberId, projectMember.id)}
            order by ${activity.startTime} desc
            limit 1
          )`.as("latest_activity_name"),
        })
        .from(projectMember)
        .innerJoin(member, eq(member.id, projectMember.memberId))
        .where(where)
        .orderBy(asc(projectMember.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(projectMember)
        .innerJoin(member, eq(member.id, projectMember.memberId))
        .where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/add", jsonBody(AddProjectMembersInput), async (c) => {
    const { projectId, memberIds, remark } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await runLadder(() =>
      db.transaction(async (tx) => {
        const ids = await ensureProjectMembers(tx, {
          projectId,
          memberIds,
          sourceType: "manual",
          userId,
        });

        // remark 是这批人共用的一句备注，ensure 的 onConflictDoNothing 不会写到
        // 已存在的行上——只补新建那些。已在项目里的人要改备注走 /update。
        if (remark) {
          await tx
            .update(projectMember)
            .set({ remark, updatedBy: userId })
            .where(
              and(
                inArray(projectMember.id, [...ids.values()]),
                sql`${projectMember.remark} is null`,
              ),
            );
        }

        return { added: ids.size };
      }),
    );

    return result.ok
      ? c.json(ok(result.data))
      : c.json(validationError(result.message));
  })

  /**
   * 手动录入。建主档 + 建项目关系在同一个事务里——人建出来了但关系没建成的
   * 话整个回滚，不会在全量库留一条谁也不知道哪来的孤儿主档。
   */
  .post("/addNew", jsonBody(AddNewProjectMemberInput), async (c) => {
    const { projectId, member: fields } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await runLadder(() =>
      db.transaction(async (tx) => {
        const memberId = await createMemberInTx(tx, fields, userId);
        await ensureProjectMembers(tx, {
          projectId,
          memberIds: [memberId],
          sourceType: "manual",
          userId,
          skipMemberCheck: true,
        });
        return { memberId };
      }),
    );

    return result.ok
      ? c.json(ok(result.data))
      : c.json(validationError(result.message));
  })

  .post("/update", jsonBody(UpdateProjectMemberInput), async (c) => {
    const { id, remark } = c.req.valid("json");

    const [row] = await db
      .update(projectMember)
      .set({ remark, updatedBy: c.get("authedUser").id })
      .where(eq(projectMember.id, id))
      .returning({ id: projectMember.id });

    return row ? c.json(ok(row)) : c.json(notFound("项目人员关系"));
  })

  /**
   * 移出项目**不级联**，有活动关系就直接拒绝。
   *
   * 这是有意跟活动层不一样的：BR-DEV-029 只授权了活动人员"一键解除当前活动下
   * 关联内容"，没给项目层同等授权——项目层一键解除意味着可能一次抹掉这个人在
   * 好几场活动里的排位和资源绑定，影响面大到不该由一次点击决定。
   *
   * 原型 project-members.html 的写法是弹一句"如该人员已被活动引用，请先到活动
   * 人员页确认是否同步移除"然后照删，那会留下"活动人员在、项目人员没了"的孤儿。
   * 这里改成阻断——数据库那条复合外键本来也会拦，接口只是把它翻成人话。
   */
  .post("/remove", jsonBody(RelationIdInput), async (c) => {
    const id = c.req.valid("json").id;

    const [related] = await db
      .select({ total: count() })
      .from(activityMember)
      .where(eq(activityMember.projectMemberId, id));

    if ((related?.total ?? 0) > 0) {
      return c.json(
        validationError(
          `该人员仍参与本项目下 ${related?.total} 场活动，请先在活动人员页移除后再移出项目`,
        ),
      );
    }

    const [row] = await db
      .delete(projectMember)
      .where(eq(projectMember.id, id))
      .returning({ id: projectMember.id });

    return row ? c.json(ok(row)) : c.json(notFound("项目人员关系"));
  });

// ---------------------------------------------------------------------------
// 活动人员
// ---------------------------------------------------------------------------

export const activityMemberRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListActivityMembersInput), async (c) => {
    const { activityId, name, companyPosition, groupName, page, pageSize } =
      c.req.valid("json");

    const where = and(
      eq(activityMember.activityId, activityId),
      name ? ilike(member.name, `%${name}%`) : undefined,
      companyPosition
        ? ilike(member.companyPosition, `%${companyPosition}%`)
        : undefined,
      groupName ? ilike(activityMember.groupName, `%${groupName}%`) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select({
          id: activityMember.id,
          ...identityFields,
          source: activityMember.source,
          groupName: activityMember.groupName,
          ownerName: activityMember.ownerName,
          originType: activityMember.originType,
          remark: activityMember.remark,
          createdAt: activityMember.createdAt,

          // 列表上直接给"参与了几个环节"，运营才看得出谁还没分配环节。
          segmentCount: sql<number>`(
            select count(*)::int from ${segmentMember}
            where ${eq(segmentMember.activityMemberId, activityMember.id)}
          )`.as("segment_count"),
        })
        .from(activityMember)
        .innerJoin(member, eq(member.id, activityMember.memberId))
        .where(where)
        .orderBy(asc(activityMember.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(activityMember)
        .innerJoin(member, eq(member.id, activityMember.memberId))
        .where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/add", jsonBody(AddActivityMembersInput), async (c) => {
    const { activityId, memberIds, originType, ...fields } =
      c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await runLadder(() =>
      db.transaction(async (tx) =>
        ensureActivityMembers(tx, {
          activityId,
          entries: memberIds.map((memberId) => ({ memberId, ...fields })),
          originType,
          userId,
        }),
      ),
    );

    return result.ok
      ? c.json(ok({ added: result.data.size }))
      : c.json(validationError(result.message));
  })

  .post("/addNew", jsonBody(AddNewActivityMemberInput), async (c) => {
    const { activityId, member: fields, ...relation } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await runLadder(() =>
      db.transaction(async (tx) => {
        const memberId = await createMemberInTx(tx, fields, userId);
        await ensureActivityMembers(tx, {
          activityId,
          entries: [{ memberId, ...relation }],
          originType: "manual",
          userId,
          skipMemberCheck: true,
        });
        return { memberId };
      }),
    );

    return result.ok
      ? c.json(ok(result.data))
      : c.json(validationError(result.message));
  })

  .post("/update", jsonBody(UpdateActivityMemberInput), async (c) => {
    const { id, ...fields } = c.req.valid("json");

    const [row] = await db
      .update(activityMember)
      .set({ ...fields, updatedBy: c.get("authedUser").id })
      .where(eq(activityMember.id, id))
      .returning({ id: activityMember.id });

    return row ? c.json(ok(row)) : c.json(notFound("活动人员关系"));
  })

  /**
   * 移除前的受影响清单。BR-DEV-029 要求"展示影响清单并二次确认"——清单由这个
   * 接口出，前端拿到什么就展示什么，不许自己拼文案。
   *
   * 目前有环节关系和资源服务绑定两项。排位、邀请函的模块建表后往这里加，
   * 前端不用改——它渲染的是这个接口返回的列表。
   */
  .post("/impact", jsonBody(RelationIdInput), async (c) => {
    const id = c.req.valid("json").id;

    const [segments, resources] = await Promise.all([
      db
        .select({ id: segmentMember.id, name: activitySegment.name })
        .from(segmentMember)
        .innerJoin(
          activitySegment,
          eq(activitySegment.id, segmentMember.segmentId),
        )
        .where(eq(segmentMember.activityMemberId, id))
        .orderBy(asc(activitySegment.startTime)),

      // 用车/用餐/住宿的服务名单。这一项尤其要展示出来：绑定表上的外键
      // 故意没设 cascade，静默删掉一份用车名单是运营完全无从察觉的损失。
      db
        .select({
          id: resourceMemberBinding.id,
          name: activityResource.name,
        })
        .from(resourceMemberBinding)
        .innerJoin(
          activityResource,
          eq(activityResource.id, resourceMemberBinding.resourceId),
        )
        .where(eq(resourceMemberBinding.activityMemberId, id))
        .orderBy(asc(activityResource.id)),
    ]);

    return c.json(
      ok({
        items: [
          {
            kind: "segment" as const,
            label: "环节人员",
            names: segments.map((s) => s.name),
          },
          {
            kind: "resource" as const,
            label: "资源服务绑定",
            names: resources.map((r) => r.name),
          },
        ].filter((item) => item.names.length > 0),
      }),
    );
  })

  .post("/remove", jsonBody(RemoveActivityMemberInput), async (c) => {
    const { id, cascade } = c.req.valid("json");

    const [[relatedSegments], [relatedBindings]] = await Promise.all([
      db
        .select({ total: count() })
        .from(segmentMember)
        .where(eq(segmentMember.activityMemberId, id)),
      db
        .select({ total: count() })
        .from(resourceMemberBinding)
        .where(eq(resourceMemberBinding.activityMemberId, id)),
    ]);
    const segmentCount = relatedSegments?.total ?? 0;
    const bindingCount = relatedBindings?.total ?? 0;

    if ((segmentCount > 0 || bindingCount > 0) && !cascade) {
      // 不是错误，是要求前端走一遍 /impact + 二次确认再回来。
      const parts = [
        segmentCount > 0 ? `${segmentCount} 个环节` : null,
        bindingCount > 0 ? `${bindingCount} 项资源服务安排` : null,
      ].filter(Boolean);
      return c.json(
        validationError(`该人员已关联 ${parts.join("、")}，请确认是否一并解除`),
      );
    }

    const row = await db.transaction(async (tx) => {
      if (segmentCount > 0) {
        await tx
          .delete(segmentMember)
          .where(eq(segmentMember.activityMemberId, id));
      }

      // 绑定表上的复合外键没有 cascade（见 resource/schema.ts 的注释），
      // 所以这里必须显式删——否则移除活动人员会撞上外键约束报 500。
      if (bindingCount > 0) {
        await tx
          .delete(resourceMemberBinding)
          .where(eq(resourceMemberBinding.activityMemberId, id));
      }

      const [deleted] = await tx
        .delete(activityMember)
        .where(eq(activityMember.id, id))
        .returning({ id: activityMember.id });

      return deleted;
    });

    // 注意这里**不动项目人员关系**：BR-DEV-029 的"只解除当前业务关系"就是
    // 字面意思，人还在项目里，随时能再分配到别的活动。
    return row ? c.json(ok(row)) : c.json(notFound("活动人员关系"));
  });

// ---------------------------------------------------------------------------
// 环节人员
// ---------------------------------------------------------------------------

export const segmentMemberRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListSegmentMembersInput), async (c) => {
    const { segmentId, name, page, pageSize } = c.req.valid("json");

    const where = and(
      eq(segmentMember.segmentId, segmentId),
      name ? ilike(member.name, `%${name}%`) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select({
          id: segmentMember.id,
          activityMemberId: segmentMember.activityMemberId,
          ...identityFields,
          segmentRole: segmentMember.segmentRole,
          originType: segmentMember.originType,
          remark: segmentMember.remark,

          // ⭐ 继承的兑现处：环节层这三列为 null 就取活动层的值。schema 里把
          // "继承"和"显式覆盖"分成 null / 有值两种状态，读取侧就必须 COALESCE
          // 回去，否则前端会看到一片空白然后自己去猜该显示什么。
          source: sql<string | null>`coalesce(${segmentMember.source}, ${activityMember.source})`.as("source"),
          groupName: sql<string | null>`coalesce(${segmentMember.groupName}, ${activityMember.groupName})`.as("group_name"),
          ownerName: sql<string | null>`coalesce(${segmentMember.ownerName}, ${activityMember.ownerName})`.as("owner_name"),

          // 前端要区分"这个值是继承来的"和"这个环节自己填的"，才好在编辑弹窗里
          // 把继承态显示成灰色占位而不是已填值。
          hasOwnRelationFields: sql<boolean>`(
            ${segmentMember.source} is not null
            or ${segmentMember.groupName} is not null
            or ${segmentMember.ownerName} is not null
          )`.as("has_own_relation_fields"),
        })
        .from(segmentMember)
        .innerJoin(member, eq(member.id, segmentMember.memberId))
        .innerJoin(
          activityMember,
          eq(activityMember.id, segmentMember.activityMemberId),
        )
        .where(where)
        .orderBy(asc(segmentMember.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(segmentMember)
        .innerJoin(member, eq(member.id, segmentMember.memberId))
        .where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  .post("/add", jsonBody(AddSegmentMembersInput), async (c) => {
    const { segmentId, entries, originType } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await runLadder(() =>
      db.transaction(async (tx) =>
        ensureSegmentMembers(tx, { segmentId, entries, originType, userId }),
      ),
    );

    return result.ok
      ? c.json(ok({ added: result.data.size }))
      : c.json(validationError(result.message));
  })

  /**
   * 手动录入。四层一个事务：主档 → 项目关系 → 活动关系 → 环节关系。
   * ensureSegmentMembers 内部会做环节的作废/开关校验，校验不过整条回滚，
   * 主档也不会留下。
   */
  .post("/addNew", jsonBody(AddNewSegmentMemberInput), async (c) => {
    const {
      segmentId,
      member: fields,
      segmentRole,
      ...relation
    } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await runLadder(() =>
      db.transaction(async (tx) => {
        const memberId = await createMemberInTx(tx, fields, userId);
        await ensureSegmentMembers(tx, {
          segmentId,
          entries: [{ memberId, segmentRole, ...relation }],
          originType: "manual",
          userId,
        });
        return { memberId };
      }),
    );

    return result.ok
      ? c.json(ok(result.data))
      : c.json(validationError(result.message));
  })

  .post("/update", jsonBody(UpdateSegmentMemberInput), async (c) => {
    const { id, ...fields } = c.req.valid("json");

    const [row] = await db
      .update(segmentMember)
      .set({ ...fields, updatedBy: c.get("authedUser").id })
      .where(eq(segmentMember.id, id))
      .returning({ id: segmentMember.id });

    return row ? c.json(ok(row)) : c.json(notFound("环节人员关系"));
  })

  // 环节是链条最末端，移除不需要影响清单——排位建表后这里要跟活动层一样加
  // /impact + cascade，因为座位分配会指向 segment_member.id。
  .post("/remove", jsonBody(RelationIdInput), async (c) => {
    const [row] = await db
      .delete(segmentMember)
      .where(eq(segmentMember.id, c.req.valid("json").id))
      .returning({ id: segmentMember.id });

    return row ? c.json(ok(row)) : c.json(notFound("环节人员关系"));
  });
