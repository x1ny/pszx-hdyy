import {
  and,
  asc,
  count,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
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
import {
  listInvitationsByActivityMember,
  releaseInvitationsByActivityMember,
} from "../invitation/cascade";
import { organization } from "../organization/schema";
import { activity } from "../project/schema";
import { activityResource, resourceMemberBinding } from "../resource/schema";
import {
  listOrganizationSeatsLeavingScope,
  listSeatsByActivityMember,
  listSeatsBySegmentMember,
  releaseOrganizationSeatsLeavingScope,
  releaseSeatsByActivityMember,
  releaseSeatsBySegmentMembers,
} from "../seating/cascade";
import {
  seatAssignment,
  segmentSeat,
  segmentSeatingPlan,
} from "../seating/schema";
import { memberTrip } from "../trip/schema";
import { activityVenue, activityVenueZone } from "../venue/schema";
import { findMemberTimeConflicts } from "./conflicts";
import {
  addActivityMembersByOrganization,
  addProjectMembersByOrganization,
  addSegmentMembersByOrganization,
  createMemberInTx,
  ensureActivityMembers,
  ensureProjectMembers,
  ensureSegmentMembers,
  MemberLadderError,
} from "./ladder";
import {
  ActivityMemberSegmentSyncError,
  syncActivityMemberSegments,
} from "./participation";
import { activityMember, member, projectMember, segmentMember } from "./schema";
import {
  AddActivityMembersByOrganizationInput,
  AddActivityMembersInput,
  AddNewActivityMemberInput,
  AddNewProjectMemberInput,
  AddNewSegmentMemberInput,
  AddProjectMembersByOrganizationInput,
  AddProjectMembersInput,
  AddSegmentMembersByOrganizationInput,
  AddSegmentMembersInput,
  ListActivityMemberSourcesInput,
  ListActivityMembersInput,
  ListProjectMembersInput,
  ListSegmentMemberConflictsInput,
  ListSegmentMembersInput,
  RelationIdInput,
  RemoveActivityMemberInput,
  RemoveSegmentMemberInput,
  SyncActivityMemberSegmentsInput,
  UpdateActivityMemberInput,
  UpdateProjectMemberInput,
  UpdateSegmentMemberInput,
} from "./validation";

const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

const notFound = (what: string) =>
  err({ code: "NOT_FOUND" as const, message: `${what}不存在` });

/**
 * 活动人员列表里的参与环节。
 *
 * 返回名称而不是计数：运营需要直接确认一个人具体参与哪些环节。每项附带 id 只为
 * 前端提供稳定身份。顺序与议程列表一致，先按开始时间，再用 id 给同一时刻的环节
 * 做稳定兜底；已经作废的环节不再发生，不应继续出现在当前参与安排里。
 *
 * 关联条件刻意用 `eq(...)`，保证 Drizzle 在相关子查询中保留全限定列名。
 */
export const activityMemberSegments = sql<
  Array<{ id: number; name: string }>
>`coalesce((
  select json_agg(
    json_build_object('id', ${segmentMember.segmentId}, 'name', ${activitySegment.name})
    order by ${activitySegment.startTime}, ${segmentMember.segmentId}
  )
  from ${segmentMember}
  join ${activitySegment} on ${eq(activitySegment.id, segmentMember.segmentId)}
  where ${eq(segmentMember.activityMemberId, activityMember.id)}
    and ${eq(activitySegment.status, "active")}
), '[]'::json)`.as("segments");

/**
 * 关系事务抛出的业务失败翻译成统一信封。这里用 throw 而不是返回错误对象，
 * 是因为这些服务整个跑在事务里——throw 顺带就是回滚，返回错误还得让每个
 * 调用方记得自己 rollback。
 */
async function runLadder<T>(
  work: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (
      error instanceof MemberLadderError ||
      error instanceof ActivityMemberSegmentSyncError
    ) {
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
  phone: member.phone,
  idType: member.idType,
  idNumber: member.idNumber,
  memberStatus: member.status,
};

/**
 * 三层列表按「范围 + 团体快照」取数的公共条件。单独导出是为了让路由 SQL 测试
 * 能钉住查询确实走关系快照列，而不是误用 member.organizationId 或 groupName。
 */
export const projectMemberScopeFilter = (
  projectId: number,
  organizationId?: number,
) =>
  and(
    eq(projectMember.projectId, projectId),
    organizationId === undefined
      ? undefined
      : eq(projectMember.organizationId, organizationId),
  );

export const activityMemberScopeFilter = (
  activityId: number,
  organizationId?: number,
) =>
  and(
    eq(activityMember.activityId, activityId),
    organizationId === undefined
      ? undefined
      : eq(activityMember.organizationId, organizationId),
  );

export const segmentMemberScopeFilter = (
  segmentId: number,
  organizationId?: number,
) =>
  and(
    eq(segmentMember.segmentId, segmentId),
    organizationId === undefined
      ? undefined
      : eq(segmentMember.organizationId, organizationId),
  );

// ---------------------------------------------------------------------------
// 项目人员
// ---------------------------------------------------------------------------

export const projectMemberRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  .post("/list", jsonBody(ListProjectMembersInput), async (c) => {
    const {
      projectId,
      name,
      companyPosition,
      sourceType,
      activityId,
      organizationId,
      page,
      pageSize,
    } = c.req.valid("json");

    const keyword = name ? `%${name}%` : undefined;
    const keywordFilter = keyword
      ? or(
          ilike(member.name, keyword),
          ilike(member.mobile, keyword),
          ilike(member.phone, keyword),
        )
      : undefined;

    const sourceFilter =
      sourceType === "activity"
        ? inArray(projectMember.sourceType, [
            "project_assign",
            "registration",
            "segment_reference",
            "backfill_from_activity",
            "backfill_from_segment",
          ])
        : sourceType
          ? eq(projectMember.sourceType, sourceType)
          : undefined;

    const activityFilter =
      activityId === -1
        ? notExists(
            db
              .select({ id: activityMember.id })
              .from(activityMember)
              .where(eq(activityMember.projectMemberId, projectMember.id)),
          )
        : typeof activityId === "number"
          ? exists(
              db
                .select({ id: activityMember.id })
                .from(activityMember)
                .where(
                  and(
                    eq(activityMember.projectMemberId, projectMember.id),
                    eq(activityMember.activityId, activityId),
                  ),
                ),
            )
          : undefined;

    const where = and(
      projectMemberScopeFilter(projectId, organizationId),
      keywordFilter,
      companyPosition
        ? ilike(member.companyPosition, `%${companyPosition}%`)
        : undefined,
      sourceFilter,
      activityFilter,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select({
          id: projectMember.id,
          organizationId: projectMember.organizationId,
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
   * 按团体把最终勾选人员批量加入项目。成员不存在、已停用或提交时已经换团体，
   * 任一硬校验失败都会让事务整批零写；已有异团体项目快照则只跳过该成员并返回
   * conflict 明细，其他人继续添加。null 历史快照会在这次明确操作中补记。
   */
  .post(
    "/addByOrganization",
    jsonBody(AddProjectMembersByOrganizationInput),
    async (c) => {
      const input = c.req.valid("json");
      const result = await runLadder(() =>
        db.transaction((tx) =>
          addProjectMembersByOrganization(tx, {
            ...input,
            userId: c.get("authedUser").id,
          }),
        ),
      );

      return result.ok
        ? c.json(ok(result.data))
        : c.json(validationError(result.message));
    },
  )

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

  .post("/listSources", jsonBody(ListActivityMemberSourcesInput), async (c) => {
    const { activityId } = c.req.valid("json");
    const rows = await db
      .selectDistinct({ source: activityMember.source })
      .from(activityMember)
      .where(
        and(
          eq(activityMember.activityId, activityId),
          isNotNull(activityMember.source),
        ),
      )
      .orderBy(asc(activityMember.source));

    // 来源是运营手填字段，不预设字典；选项始终来自当前活动已有记录。
    return c.json(
      ok(rows.flatMap(({ source }) => (source?.trim() ? [source] : []))),
    );
  })

  .post("/list", jsonBody(ListActivityMembersInput), async (c) => {
    const {
      activityId,
      name,
      companyPosition,
      source,
      groupName,
      ownerName,
      organizationId,
      memberStatus,
      page,
      pageSize,
    } = c.req.valid("json");

    const where = and(
      activityMemberScopeFilter(activityId, organizationId),
      name ? ilike(member.name, `%${name}%`) : undefined,
      companyPosition
        ? ilike(member.companyPosition, `%${companyPosition}%`)
        : undefined,
      source ? ilike(activityMember.source, `%${source}%`) : undefined,
      groupName ? ilike(activityMember.groupName, `%${groupName}%`) : undefined,
      ownerName ? ilike(activityMember.ownerName, `%${ownerName}%`) : undefined,
      memberStatus ? eq(member.status, memberStatus) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select({
          id: activityMember.id,
          organizationId: activityMember.organizationId,
          organizationName: organization.name,
          ...identityFields,
          source: activityMember.source,
          groupName: activityMember.groupName,
          ownerName: activityMember.ownerName,
          originType: activityMember.originType,
          remark: activityMember.remark,
          createdAt: activityMember.createdAt,
          segments: activityMemberSegments,
        })
        .from(activityMember)
        .innerJoin(member, eq(member.id, activityMember.memberId))
        .leftJoin(
          organization,
          eq(organization.id, activityMember.organizationId),
        )
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

  /**
   * 查询一条活动人员详情：人员主档摘要、当前活动关系和完整环节参与。
   *
   * 详情单独查询而不继续加宽 `/list`：国别、证件、联系方式和排位信息只在用户
   * 点开某一行时需要，塞进分页列表会让每次筛选、翻页都重复传输这些低频字段。
   */
  .post("/get", jsonBody(RelationIdInput), async (c) => {
    const id = c.req.valid("json").id;

    const [detail] = await db
      .select({
        id: activityMember.id,
        organizationId: activityMember.organizationId,
        memberId: member.id,
        name: member.name,
        gender: member.gender,
        // 只取名字快照：这个详情是纯展示，不做回填，用不上码。
        countryRegion: member.countryRegion,
        nativeProvince: member.nativeProvince,
        nativeCity: member.nativeCity,
        companyPosition: member.companyPosition,
        idType: member.idType,
        idNumber: member.idNumber,
        mobile: member.mobile,
        phone: member.phone,
        email: member.email,
        language: member.language,
        source: activityMember.source,
        groupName: activityMember.groupName,
        ownerName: activityMember.ownerName,
        originType: activityMember.originType,
        remark: activityMember.remark,
      })
      .from(activityMember)
      .innerJoin(member, eq(member.id, activityMember.memberId))
      .where(eq(activityMember.id, id))
      .limit(1);

    if (!detail) return c.json(notFound("活动人员关系"));

    const segments = await db
      .select({
        id: segmentMember.id,
        organizationId: segmentMember.organizationId,
        segmentId: activitySegment.id,
        name: activitySegment.name,
        status: activitySegment.status,
        memberEnabled: activitySegment.memberEnabled,
        segmentRole: segmentMember.segmentRole,
        ownerName: sql<
          string | null
        >`coalesce(${segmentMember.ownerName}, ${activityMember.ownerName})`.as(
          "owner_name",
        ),
        seatingStatus: segmentSeatingPlan.status,
        venueName: activityVenue.name,
        zoneName: activityVenueZone.name,
        seatLabel: segmentSeat.label,
      })
      .from(segmentMember)
      .innerJoin(
        activityMember,
        eq(activityMember.id, segmentMember.activityMemberId),
      )
      .innerJoin(
        activitySegment,
        eq(activitySegment.id, segmentMember.segmentId),
      )
      // 作废方案不是当前排位。partial unique index 保证一个环节至多命中一条
      // 非作废方案，因此后面的座位关联不会把同一条环节人员展开成多行。
      .leftJoin(
        segmentSeatingPlan,
        and(
          eq(segmentSeatingPlan.segmentId, segmentMember.segmentId),
          ne(segmentSeatingPlan.status, "voided"),
        ),
      )
      .leftJoin(
        activityVenueZone,
        eq(activityVenueZone.id, segmentSeatingPlan.activityVenueZoneId),
      )
      .leftJoin(
        activityVenue,
        eq(activityVenue.id, activityVenueZone.activityVenueId),
      )
      .leftJoin(
        seatAssignment,
        and(
          eq(seatAssignment.planId, segmentSeatingPlan.id),
          eq(seatAssignment.segmentMemberId, segmentMember.id),
          eq(seatAssignment.occupantType, "person"),
          isNull(seatAssignment.revokedAt),
        ),
      )
      .leftJoin(segmentSeat, eq(segmentSeat.id, seatAssignment.segmentSeatId))
      // 编辑关系必须看见作废/关闭人员管理的历史关系，才能按只读口径保留；
      // 分页列表仍只展示正常环节，不改变列表的“当前参与”口径。
      .where(eq(segmentMember.activityMemberId, id))
      .orderBy(asc(activitySegment.startTime), asc(activitySegment.id));

    return c.json(ok({ ...detail, segments }));
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

  /**
   * 按团体批量加入活动并自动补齐项目。硬校验失败整批零写；项目或活动任一层已有
   * 异团体快照时，该成员整条 ladder 不写并返回 conflict + skipped，其他成员仍在
   * 同一事务提交。响应恒满足 added + existing + skipped = 去重后的请求人数。
   */
  .post(
    "/addByOrganization",
    jsonBody(AddActivityMembersByOrganizationInput),
    async (c) => {
      const input = c.req.valid("json");
      const result = await runLadder(() =>
        db.transaction((tx) =>
          addActivityMembersByOrganization(tx, {
            ...input,
            userId: c.get("authedUser").id,
          }),
        ),
      );

      return result.ok
        ? c.json(ok(result.data))
        : c.json(validationError(result.message));
    },
  )

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
   * 原子同步一名活动人员参与的可编辑环节集合。
   *
   * 期望集合只接受当前活动内、未作废且已开启人员管理的环节。既有只读历史关系
   * 永远保留；取消环节若命中有效个人排位、因范围归零而失效的团体占位，或该人
   * 的环节行程，则返回 `ok({ applied:false, blocked })` 明细且整次零写。
   */
  .post(
    "/syncSegments",
    jsonBody(SyncActivityMemberSegmentsInput),
    async (c) => {
      const { activityMemberId, segmentIds } = c.req.valid("json");
      const result = await runLadder(() =>
        db.transaction((tx) =>
          syncActivityMemberSegments(tx, {
            activityMemberId,
            segmentIds,
            userId: c.get("authedUser").id,
          }),
        ),
      );

      return result.ok
        ? c.json(ok(result.data))
        : c.json(validationError(result.message));
    },
  )

  /**
   * 移除前的受影响清单。BR-DEV-029 要求"展示影响清单并二次确认"——清单由这个
   * 接口出，前端拿到什么就展示什么，不许自己拼文案。
   *
   * 目前有环节关系、资源服务绑定和人员行程三项。排位、邀请函的模块建表后往这里加，
   * 前端不用改——它渲染的是这个接口返回的列表。
   */
  .post("/impact", jsonBody(RelationIdInput), async (c) => {
    const id = c.req.valid("json").id;

    const [segments, resources, trips] = await Promise.all([
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

      db
        .select({
          id: memberTrip.id,
          departureLocation: memberTrip.departureLocation,
          destination: memberTrip.destination,
        })
        .from(memberTrip)
        .where(eq(memberTrip.activityMemberId, id))
        .orderBy(asc(memberTrip.departureTime), asc(memberTrip.id)),
    ]);

    // 座位和邀请函各查一次。两者都跨模块，且都是"外键故意没设 cascade、
    // 要求先展示清单再显式解除"的同一类下游关联。
    const [seats, organizationSeats, invitations] = await Promise.all([
      listSeatsByActivityMember(db, id),
      listOrganizationSeatsLeavingScope(
        db,
        segments.map((segment) => segment.id),
      ),
      listInvitationsByActivityMember(db, id),
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
            // 座位必须单独列一项、而且要报到具体座位号：运营看到"3 个座位"和
            // 看到"开幕式 A3、主论坛 B7"是两种决策质量。移除之后这几个位置就空了，
            // 得有人去补。
            kind: "seat" as const,
            label: "排位座位",
            names: [
              ...seats.map((s) => `${s.segmentName} ${s.seatLabel}`),
              ...organizationSeats.map(
                (seat) => `${seat.segmentName} ${seat.seatLabel}（团体占位）`,
              ),
            ],
          },
          {
            // 邀请函是"公函留痕"，schema 里那条外键故意不设 cascade 就是为了
            // 不让一次误删悄悄带走它。解除必须是用户看过清单之后的显式动作。
            kind: "invitation" as const,
            label: "邀请函记录",
            names: invitations.map((i) => i.batchName ?? `#${i.id}`),
          },
          {
            kind: "resource" as const,
            label: "资源服务绑定",
            names: resources.map((r) => r.name),
          },
          {
            kind: "trip" as const,
            label: "人员行程",
            names: trips.map(
              (trip) => `${trip.departureLocation} → ${trip.destination}`,
            ),
          },
        ].filter((item) => item.names.length > 0),
      }),
    );
  })

  .post("/remove", jsonBody(RemoveActivityMemberInput), async (c) => {
    const { id, cascade } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const [
      relatedSegmentMembers,
      [relatedBindings],
      [relatedTrips],
      relatedSeats,
      relatedInvitations,
    ] = await Promise.all([
      db
        .select({ id: segmentMember.id })
        .from(segmentMember)
        .where(eq(segmentMember.activityMemberId, id)),
      db
        .select({ total: count() })
        .from(resourceMemberBinding)
        .where(eq(resourceMemberBinding.activityMemberId, id)),
      db
        .select({ total: count() })
        .from(memberTrip)
        .where(eq(memberTrip.activityMemberId, id)),
      listSeatsByActivityMember(db, id),
      listInvitationsByActivityMember(db, id),
    ]);
    const organizationSeats = await listOrganizationSeatsLeavingScope(
      db,
      relatedSegmentMembers.map((item) => item.id),
    );
    const segmentCount = relatedSegmentMembers.length;
    const bindingCount = relatedBindings?.total ?? 0;
    const tripCount = relatedTrips?.total ?? 0;
    const seatCount = relatedSeats.length;
    const organizationSeatCount = organizationSeats.length;
    const invitationCount = relatedInvitations.length;

    if (
      (segmentCount > 0 ||
        bindingCount > 0 ||
        tripCount > 0 ||
        seatCount > 0 ||
        organizationSeatCount > 0 ||
        invitationCount > 0) &&
      !cascade
    ) {
      // 不是错误，是要求前端走一遍 /impact + 二次确认再回来。
      const parts = [
        segmentCount > 0 ? `${segmentCount} 个环节` : null,
        // 座位排在环节后面：它比"参与哪些环节"更具体，移除之后会直接留下
        // 空位需要补人，是这几项里最需要被看见的。
        seatCount > 0 ? `${seatCount} 个已排座位` : null,
        organizationSeatCount > 0
          ? `${organizationSeatCount} 个团体占位（该团体将离开环节范围）`
          : null,
        invitationCount > 0 ? `${invitationCount} 份邀请函记录` : null,
        bindingCount > 0 ? `${bindingCount} 项资源服务安排` : null,
        tripCount > 0 ? `${tripCount} 条行程` : null,
      ].filter(Boolean);
      return c.json(
        validationError(`该人员已关联 ${parts.join("、")}，请确认是否一并解除`),
      );
    }

    const row = await db.transaction(async (tx) => {
      /**
       * ⚠️ 顺序有讲究：下面这几张表对 activity_member / segment_member 的外键
       * **都故意没有 cascade**（各自 schema 里有理由），所以必须在删上游之前
       * 显式清掉，否则撞约束报 500。
       *
       * 座位那条在 docs/场地排位交互评审.md §3.1 复现过；邀请函那条是修它的
       * 时候连带发现的同一类问题，schema 注释里早写了"应该显式删记录"，
       * 只是一直没人实现。
       */
      if (seatCount > 0) {
        await releaseSeatsByActivityMember(tx, id, userId);
      }
      if (organizationSeatCount > 0) {
        await releaseOrganizationSeatsLeavingScope(
          tx,
          relatedSegmentMembers.map((item) => item.id),
          userId,
        );
      }
      if (invitationCount > 0) {
        await releaseInvitationsByActivityMember(tx, id);
      }

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

      if (tripCount > 0) {
        await tx.delete(memberTrip).where(eq(memberTrip.activityMemberId, id));
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
    const { segmentId, name, organizationId, page, pageSize } =
      c.req.valid("json");

    const where = and(
      segmentMemberScopeFilter(segmentId, organizationId),
      name ? ilike(member.name, `%${name}%`) : undefined,
    );

    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      db
        .select({
          id: segmentMember.id,
          activityMemberId: segmentMember.activityMemberId,
          organizationId: segmentMember.organizationId,
          ...identityFields,
          segmentRole: segmentMember.segmentRole,
          originType: segmentMember.originType,
          remark: segmentMember.remark,

          // ⭐ 继承的兑现处：环节层这三列为 null 就取活动层的值。schema 里把
          // "继承"和"显式覆盖"分成 null / 有值两种状态，读取侧就必须 COALESCE
          // 回去，否则前端会看到一片空白然后自己去猜该显示什么。
          source: sql<
            string | null
          >`coalesce(${segmentMember.source}, ${activityMember.source})`.as(
            "source",
          ),
          groupName: sql<
            string | null
          >`coalesce(${segmentMember.groupName}, ${activityMember.groupName})`.as(
            "group_name",
          ),
          ownerName: sql<
            string | null
          >`coalesce(${segmentMember.ownerName}, ${activityMember.ownerName})`.as(
            "owner_name",
          ),

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

  /**
   * 全活动的人员时间冲突（C-016 的"人员冲突"，只提示不阻断）。
   *
   * 一次把本活动所有环节人员连着环节时间捞回来，配对判定交给
   * findMemberTimeConflicts——理由见 conflicts.ts 顶部。`segment_member.activityId`
   * 那列冗余就是为这类"按活动汇总"的查询留的。同一批行顺带按环节汇总
   * 人数，给议程节点判断"人员未配置 / 已配置 N 人"；不另发一条几乎相同的
   * 全活动查询。
   */
  .post("/conflicts", jsonBody(ListSegmentMemberConflictsInput), async (c) => {
    const { activityId } = c.req.valid("json");

    const rows = await db
      .select({
        memberId: segmentMember.memberId,
        memberName: member.name,
        segmentId: activitySegment.id,
        segmentName: activitySegment.name,
        startTime: activitySegment.startTime,
        endTime: activitySegment.endTime,
        segmentStatus: activitySegment.status,
      })
      .from(segmentMember)
      .innerJoin(member, eq(member.id, segmentMember.memberId))
      .innerJoin(
        activitySegment,
        eq(activitySegment.id, segmentMember.segmentId),
      )
      .where(eq(segmentMember.activityId, activityId));

    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(row.segmentId, (counts.get(row.segmentId) ?? 0) + 1);
    }

    // 作废环节的人员仍要计入上面的配置人数（历史关系没有消失），但不占时间段，
    // 因此只在冲突计算前过滤，和同议程线的重叠校验保持同一口径。
    const activeRows = rows.filter((row) => row.segmentStatus === "active");

    return c.json(
      ok({
        list: findMemberTimeConflicts(activeRows),
        memberCounts: [...counts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([segmentId, count]) => ({ segmentId, count })),
      }),
    );
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
   * 按团体批量加入环节并自动补齐活动、项目。环节必须正常且开启人员管理；人员与
   * 环节硬校验任一失败整批零写。三层任一异团体快照只跳过该成员整条 ladder，
   * null 快照则逐层补记并通过 filledLayers 明细返回。
   */
  .post(
    "/addByOrganization",
    jsonBody(AddSegmentMembersByOrganizationInput),
    async (c) => {
      const input = c.req.valid("json");
      const result = await runLadder(() =>
        db.transaction((tx) =>
          addSegmentMembersByOrganization(tx, {
            ...input,
            userId: c.get("authedUser").id,
          }),
        ),
      );

      return result.ok
        ? c.json(ok(result.data))
        : c.json(validationError(result.message));
    },
  )

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

  /**
   * 环节人员移除。
   *
   * 排位建起来之后，环节人员**不再是链条末端**——个人类型的
   * `seat_assignment` 指向 `segment_member.id`，而那条外键没有 cascade。所以
   * 这里跟活动层一样要先报清单、二次确认，再连座位一起解；团体占位不绑定某
   * 个成员，但若移除的是团体在本环节的最后一人，范围快照归零时也会一起解除。
   */
  .post("/remove", jsonBody(RemoveSegmentMemberInput), async (c) => {
    const { id, cascade } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const [seats, organizationSeats] = await Promise.all([
      listSeatsBySegmentMember(db, id),
      listOrganizationSeatsLeavingScope(db, [id]),
    ]);

    if ((seats.length > 0 || organizationSeats.length > 0) && !cascade) {
      const impacts = [
        seats.length > 0
          ? `个人排位 ${seats.map((seat) => seat.seatLabel).join("、")}`
          : null,
        organizationSeats.length > 0
          ? `团体占位 ${organizationSeats
              .map((seat) => seat.seatLabel)
              .join("、")}`
          : null,
      ].filter(Boolean);
      return c.json(
        validationError(
          `移除后将解除${impacts.join("及")}，请确认是否一并解除排位`,
        ),
      );
    }

    const row = await db.transaction(async (tx) => {
      if (seats.length > 0) {
        await releaseSeatsBySegmentMembers(tx, [id], userId);
      }
      if (organizationSeats.length > 0) {
        await releaseOrganizationSeatsLeavingScope(tx, [id], userId);
      }
      const [deleted] = await tx
        .delete(segmentMember)
        .where(eq(segmentMember.id, id))
        .returning({ id: segmentMember.id });
      return deleted;
    });

    return row ? c.json(ok(row)) : c.json(notFound("环节人员关系"));
  });
