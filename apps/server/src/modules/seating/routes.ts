import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { ensureSegmentMemberFromActivity } from "../member/ladder";
import { activityMember, member, segmentMember } from "../member/schema";
import { organization } from "../organization/schema";
import {
  activityVenue,
  activityVenueLayout,
  activityVenueZone,
} from "../venue/schema";
import {
  findInvalidAssignments,
  isWritable,
  organizationColorIndex,
  type PlanSeatRow,
  planOrganizationSeatAssignments,
  planSeatMerge,
  swapAssignmentSeats,
} from "./plan";
import {
  seatAssignment,
  segmentSeat,
  segmentSeatingLayout,
  segmentSeatingLog,
  segmentSeatingPlan,
} from "./schema";
import { currentPlanJoin, inSeatingScope } from "./stats";
import {
  ActivityIdInput,
  AssignActivityMemberInput,
  AssignInput,
  AssignOrganizationInput,
  ConfirmPlanInput,
  CreatePlanInput,
  ListCandidatesInput,
  ListPlansInput,
  OrganizationSeatBatchInput,
  type OrganizationSeatBatchPayload,
  PlanIdInput,
  RejectPlanInput,
  SavePlanLayoutInput,
  SetSeatEnabledInput,
  SwapInput,
  UnassignInput,
  UnassignOrganizationInput,
  VoidPlanInput,
} from "./validation";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const notFound = (message = "排位方案不存在") =>
  err({ code: "NOT_FOUND" as const, message });

const invalid = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

const planFields = {
  id: segmentSeatingPlan.id,
  segmentId: segmentSeatingPlan.segmentId,
  activityId: segmentSeatingPlan.activityId,
  activityVenueZoneId: segmentSeatingPlan.activityVenueZoneId,
  status: segmentSeatingPlan.status,
  version: segmentSeatingPlan.version,
  rejectedReason: segmentSeatingPlan.rejectedReason,
  savedAt: segmentSeatingPlan.savedAt,
  confirmedAt: segmentSeatingPlan.confirmedAt,
};

const seatFields = {
  id: segmentSeat.id,
  externalId: segmentSeat.externalId,
  sourceExternalId: segmentSeat.sourceExternalId,
  label: segmentSeat.label,
  kind: segmentSeat.kind,
  rank: segmentSeat.rank,
  enabled: segmentSeat.enabled,
  ordinal: segmentSeat.ordinal,
};

/** 还没被撤销的分配。整个模块对"生效中"的定义只有这一处。 */
const liveAssignment = isNull(seatAssignment.revokedAt);

/** 未软删的位置。 */
const liveSeat = isNull(segmentSeat.removedAt);

/**
 * 当前环节的排位候选人查询。
 *
 * 从 `activityMember` 出发也要用 inner join `segmentMember`：活动人员只是上游
 * 范围，只有已经建立当前环节关系的人才允许出现在排位面板里。
 */
export const listCandidatesQuery = (
  planId: number,
  plan: { segmentId: number; activityId: number },
  keyword?: string,
) =>
  db
    .select({
      activityMemberId: activityMember.id,
      memberId: member.id,
      name: member.name,
      companyPosition: member.companyPosition,
      mobile: member.mobile,
      segmentMemberId: segmentMember.id,
      organizationId: segmentMember.organizationId,
      takenSeatLabel: sql<string | null>`(
        select ${segmentSeat.label} from ${seatAssignment}
        join ${segmentSeat} on ${eq(segmentSeat.id, seatAssignment.segmentSeatId)}
        where ${eq(seatAssignment.segmentMemberId, segmentMember.id)}
          and ${eq(seatAssignment.planId, planId)}
          and ${seatAssignment.occupantType} = 'person'
          and ${seatAssignment.revokedAt} is null
        limit 1
      )`.as("taken_seat_label"),
    })
    .from(activityMember)
    .innerJoin(member, eq(member.id, activityMember.memberId))
    .innerJoin(
      segmentMember,
      and(
        eq(segmentMember.activityMemberId, activityMember.id),
        eq(segmentMember.segmentId, plan.segmentId),
      ),
    )
    .where(
      and(
        eq(activityMember.activityId, plan.activityId),
        keyword
          ? or(
              ilike(member.name, `%${keyword}%`),
              ilike(member.mobile, `%${keyword}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(member.name))
    .limit(200);

/** 当前方案环节范围内可作团体占位的团体，不统计人数也不做批量排座。 */
export const listOrganizationCandidatesQuery = (segmentId: number) =>
  db
    .selectDistinct({ id: organization.id, name: organization.name })
    .from(segmentMember)
    .innerJoin(organization, eq(organization.id, segmentMember.organizationId))
    .where(eq(segmentMember.segmentId, segmentId))
    .orderBy(asc(organization.name), asc(organization.id));

/** 团体占位的范围守卫：只认当前环节成员关系上的 organizationId 历史快照。 */
export const organizationInSegmentScopeQuery = (
  conn: Pick<typeof db, "select">,
  segmentId: number,
  organizationId: number,
) =>
  conn
    .select({ id: segmentMember.id })
    .from(segmentMember)
    .where(
      and(
        eq(segmentMember.segmentId, segmentId),
        eq(segmentMember.organizationId, organizationId),
      ),
    )
    .limit(1);

/**
 * 当前方案环节内的团体排位统计。个人已排座只数个人分配；团体占位是另一种目标，
 * 不会反过来把成员算作“已个人排座”。
 */
export const listOrganizationSeatingStatsQuery = (
  conn: Pick<typeof db, "select">,
  planId: number,
  segmentId: number,
) =>
  conn
    .select({
      organizationId: organization.id,
      name: organization.name,
      totalMembers: sql<number>`count(distinct ${segmentMember.id})::int`.as(
        "total_members",
      ),
      assignedPersonCount: sql<number>`count(${seatAssignment.id})::int`.as(
        "assigned_person_count",
      ),
      organizationSeatCount: sql<number>`(
        select count(*)::int
        from ${seatAssignment} as "organization_assignment"
        where "organization_assignment"."plan_id" = ${planId}
          and "organization_assignment"."organization_id" = ${organization.id}
          and "organization_assignment"."occupant_type" = 'organization'
          and "organization_assignment"."revoked_at" is null
      )`.as("organization_seat_count"),
    })
    .from(segmentMember)
    .innerJoin(organization, eq(organization.id, segmentMember.organizationId))
    .leftJoin(
      seatAssignment,
      and(
        eq(seatAssignment.segmentMemberId, segmentMember.id),
        eq(seatAssignment.planId, planId),
        eq(seatAssignment.occupantType, "person"),
        liveAssignment,
      ),
    )
    .where(eq(segmentMember.segmentId, segmentId))
    .groupBy(organization.id, organization.name)
    .orderBy(asc(organization.name), asc(organization.id));

type OrganizationSeatingStatRow = {
  organizationId: number;
  name: string;
  totalMembers: number;
  assignedPersonCount: number;
  organizationSeatCount: number;
};

function withOrganizationSeatingStats(rows: OrganizationSeatingStatRow[]) {
  return rows.map((row) => ({
    ...row,
    colorIndex: organizationColorIndex(row.organizationId),
    remainingMemberCount: Math.max(
      0,
      row.totalMembers - row.assignedPersonCount,
    ),
  }));
}

function organizationSeatTargetCount(
  input: OrganizationSeatBatchPayload,
  remainingMemberCount: number,
) {
  return input.targetMode === "remaining"
    ? remainingMemberCount
    : input.targetCount;
}

/**
 * 按用户给定顺序读取位置可用性。未知位置、跨方案位置和软删位置不会混为可用；
 * 预览与真正批量写入共用此函数，避免两条路径各自解释“空闲位置”。
 */
async function listOrganizationSeatAvailability(
  tx: Tx,
  planId: number,
  orderedSeatIds: number[],
) {
  if (!orderedSeatIds.length) return [];

  const [seats, occupied] = await Promise.all([
    tx
      .select({
        id: segmentSeat.id,
        enabled: segmentSeat.enabled,
        removedAt: segmentSeat.removedAt,
      })
      .from(segmentSeat)
      .where(
        and(
          eq(segmentSeat.planId, planId),
          inArray(segmentSeat.id, orderedSeatIds),
        ),
      ),
    tx
      .select({ seatId: seatAssignment.segmentSeatId })
      .from(seatAssignment)
      .where(
        and(
          eq(seatAssignment.planId, planId),
          inArray(seatAssignment.segmentSeatId, orderedSeatIds),
          liveAssignment,
        ),
      ),
  ]);

  const bySeatId = new Map(seats.map((seat) => [seat.id, seat]));
  const occupiedSeatIds = new Set(occupied.map((row) => row.seatId));

  return orderedSeatIds.map((seatId) => {
    const seat = bySeatId.get(seatId);
    if (!seat) return { seatId, status: "notFound" as const };
    if (seat.removedAt !== null) return { seatId, status: "removed" as const };
    if (!seat.enabled) return { seatId, status: "disabled" as const };
    if (occupiedSeatIds.has(seatId)) {
      return { seatId, status: "occupied" as const };
    }
    return { seatId, status: "available" as const };
  });
}

async function organizationSeatPreview(
  tx: Tx,
  input: OrganizationSeatBatchPayload,
) {
  const [plan] = await tx
    .select({
      segmentId: segmentSeatingPlan.segmentId,
      status: segmentSeatingPlan.status,
    })
    .from(segmentSeatingPlan)
    .where(eq(segmentSeatingPlan.id, input.planId));
  if (!plan) return { kind: "notFound" as const };
  if (!isWritable(plan.status)) {
    return { kind: "invalid" as const, error: "方案已作废，不能再修改" };
  }

  const [scopedOrganization] = await organizationInSegmentScopeQuery(
    tx,
    plan.segmentId,
    input.organizationId,
  );
  if (!scopedOrganization) {
    return { kind: "invalid" as const, error: "该团体不在当前环节范围内" };
  }

  const rows = await listOrganizationSeatingStatsQuery(
    tx,
    input.planId,
    plan.segmentId,
  );
  const stats = withOrganizationSeatingStats(rows).find(
    (row) => row.organizationId === input.organizationId,
  );
  if (!stats) {
    // 上面的范围查询已命中；留这一层是为并发删除 relation 时提供确定的业务结果。
    return { kind: "invalid" as const, error: "该团体不在当前环节范围内" };
  }

  const targetCount = organizationSeatTargetCount(
    input,
    stats.remainingMemberCount,
  );
  const availability = await listOrganizationSeatAvailability(
    tx,
    input.planId,
    input.orderedSeatIds,
  );

  return {
    kind: "ok" as const,
    plan,
    stats,
    targetCount,
    preview: planOrganizationSeatAssignments(targetCount, availability),
  };
}

async function writeLog(
  tx: Tx,
  planId: number,
  action: (typeof segmentSeatingLog.$inferInsert)["action"],
  operatorId: string,
  payload?: unknown,
) {
  await tx
    .insert(segmentSeatingLog)
    .values({ planId, action, operatorId, payload: payload ?? null });
}

/** postgres.js 会把约束错误直接抛出；个别运行时则再包一层 cause。 */
function hasDatabaseCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === code) return true;
  return "cause" in error && hasDatabaseCode(error.cause, code);
}

/**
 * 任何写操作之后方案都回到 `pending`，`version` 不动（§3.4）。
 *
 * 已确认的方案被改回 pending 时要给前端一个警示：那份排位已经发过座位通知，
 * 改了要重发。这里只负责改状态，警示由调用方根据返回的 `wasConfirmed` 决定。
 */
async function touchPlan(tx: Tx, planId: number, userId: string) {
  const [before] = await tx
    .select({ status: segmentSeatingPlan.status })
    .from(segmentSeatingPlan)
    .where(eq(segmentSeatingPlan.id, planId));

  await tx
    .update(segmentSeatingPlan)
    .set({ status: "pending", savedBy: userId, savedAt: new Date() })
    .where(eq(segmentSeatingPlan.id, planId));

  return { wasConfirmed: before?.status === "confirmed" };
}

/**
 * 座位 id → 占座对象显示名。归并只关心位置是否有人，个人和团体都必须挡住
 * 删除/停用；团体名称前缀避免被误解成某个具体成员。
 */
async function occupiedSeats(tx: Tx, planId: number) {
  const rows = await tx
    .select({
      seatId: seatAssignment.segmentSeatId,
      name: sql<string>`case
        when ${seatAssignment.occupantType} = 'organization'
          then concat('团体：', ${organization.name})
        else ${member.name}
      end`.as("occupant_name"),
    })
    .from(seatAssignment)
    .leftJoin(
      segmentMember,
      eq(segmentMember.id, seatAssignment.segmentMemberId),
    )
    .leftJoin(member, eq(member.id, segmentMember.memberId))
    .leftJoin(organization, eq(organization.id, seatAssignment.organizationId))
    .where(and(eq(seatAssignment.planId, planId), liveAssignment));

  return new Map(rows.map((row) => [row.seatId, row.name]));
}

export const seatingRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 本活动的排位总览：**每个开了排位开关的环节一行**，有方案的带上方案。
   *
   * 以环节为主而不是以方案为主，是因为"未配置"是个派生态——它没有方案行
   * （§7），左连接才能把它显示出来。原型 seating-list.html 的第三行
   * （设计师品牌展演 / 未配置）就是这种。
   *
   * 顺带把原型 seating-confirm.html 那一页合并进来了：两页的列几乎完全重合，
   * 拆开的唯一理由是它们挂在两个二级菜单下，菜单一收就该合成一页 + 状态筛选。
   */
  .post("/listPlans", jsonBody(ListPlansInput), async (c) => {
    const { activityId, segmentId, status } = c.req.valid("json");

    const rows = await db
      .select({
        segmentId: activitySegment.id,
        segmentName: activitySegment.name,
        segmentStatus: activitySegment.status,
        startTime: activitySegment.startTime,
        seatingEnabled: activitySegment.seatingEnabled,
        plan: planFields,
        zoneName: activityVenueZone.name,
        venueName: activityVenue.name,
        seatCount: sql<number>`(
          select count(*)::int from ${segmentSeat}
          where ${eq(segmentSeat.planId, segmentSeatingPlan.id)}
            and ${segmentSeat.removedAt} is null
            and ${segmentSeat.enabled}
        )`.as("seat_count"),
        assignedCount: sql<number>`(
          select count(*)::int from ${seatAssignment}
          where ${eq(seatAssignment.planId, segmentSeatingPlan.id)}
            and ${seatAssignment.revokedAt} is null
        )`.as("assigned_count"),
      })
      .from(activitySegment)
      // 左连接：没有方案的环节也要出现，那正是"未配置"。连接条件（含"作废
      // 方案不算当前方案"）和下面的 inSeatingScope 是一套，都在 stats.ts。
      .leftJoin(segmentSeatingPlan, currentPlanJoin)
      .leftJoin(
        activityVenueZone,
        eq(activityVenueZone.id, segmentSeatingPlan.activityVenueZoneId),
      )
      .leftJoin(
        activityVenue,
        eq(activityVenue.id, activityVenueZone.activityVenueId),
      )
      .where(
        and(
          eq(activitySegment.activityId, activityId),
          // 从环节详情进入时只展示该环节；不带参数仍返回活动总览。
          segmentId ? eq(activitySegment.id, segmentId) : undefined,
          // 「开关开着 或 已有非作废方案」——规则本身连同它的来历都写在
          // stats.ts；活动配置总览是同一条规则的第二个读者。
          inSeatingScope,
          status ? eq(segmentSeatingPlan.status, status) : undefined,
        ),
      )
      .orderBy(asc(activitySegment.startTime), asc(activitySegment.id));

    return c.json(ok({ list: rows }));
  })

  /**
   * 每个活动区域被几个方案引用。
   *
   * 场地空间页的"被排位引用"统计卡和"引用环节"那一列读它。**由 seating 提供
   * 而不是 venue 自己算**：venue 不认识 seating（§2 的单向依赖），前端多发一个
   * 请求也不能把依赖方向弄反。
   */
  .post("/zoneUsage", jsonBody(ActivityIdInput), async (c) => {
    const { activityId } = c.req.valid("json");

    const rows = await db
      .select({
        activityVenueZoneId: segmentSeatingPlan.activityVenueZoneId,
        segmentId: activitySegment.id,
        segmentName: activitySegment.name,
        status: segmentSeatingPlan.status,
      })
      .from(segmentSeatingPlan)
      .innerJoin(
        activitySegment,
        eq(activitySegment.id, segmentSeatingPlan.segmentId),
      )
      .where(
        and(
          eq(segmentSeatingPlan.activityId, activityId),
          sql`${segmentSeatingPlan.status} <> 'voided'`,
        ),
      )
      .orderBy(asc(activitySegment.startTime));

    return c.json(ok({ list: rows }));
  })

  /** 方案的全部内容：画布 blob + 位置 + 生效分配。画布页一次拿全。 */
  .post("/getPlan", jsonBody(PlanIdInput), async (c) => {
    const { planId } = c.req.valid("json");

    const [plan] = await db
      .select({
        ...planFields,
        segmentName: activitySegment.name,
        zoneName: activityVenueZone.name,
        zoneExternalId: activityVenueZone.externalId,
        zoneCapacity: activityVenueZone.capacity,
        activityVenueId: activityVenueZone.activityVenueId,
        venueName: activityVenue.name,
        /**
         * 上游那份活动空间画布最后改于何时。
         *
         * 前端拿它跟本方案的 `savedAt` 比——上游更新就说明这份排位的底图是
         * 旧快照了。**只用来提示，不触发任何自动同步**：快照隔离本来就是
         * 设计意图（§2.2），自动跟随会让已确认的排位静默变形。
         * 缺的只是"让用户知道"，这一列补的就是那个（评审 §3.8）。
         */
        spaceUpdatedAt: activityVenueLayout.updatedAt,
      })
      .from(segmentSeatingPlan)
      .innerJoin(
        activitySegment,
        eq(activitySegment.id, segmentSeatingPlan.segmentId),
      )
      .innerJoin(
        activityVenueZone,
        eq(activityVenueZone.id, segmentSeatingPlan.activityVenueZoneId),
      )
      .innerJoin(
        activityVenue,
        eq(activityVenue.id, activityVenueZone.activityVenueId),
      )
      // left：源场地没画过平面图时活动层也没有 blob 行，那时候无从比较，
      // spaceUpdatedAt 为 null，前端不显示提示。
      .leftJoin(
        activityVenueLayout,
        eq(
          activityVenueLayout.activityVenueId,
          activityVenueZone.activityVenueId,
        ),
      )
      .where(eq(segmentSeatingPlan.id, planId));

    if (!plan) return c.json(notFound());

    const [layout, seats, assignments] = await Promise.all([
      db
        .select({
          rendererKind: segmentSeatingLayout.rendererKind,
          rendererVersion: segmentSeatingLayout.rendererVersion,
          data: segmentSeatingLayout.data,
        })
        .from(segmentSeatingLayout)
        .where(eq(segmentSeatingLayout.planId, planId))
        .then((rows) => rows[0] ?? null),
      db
        .select(seatFields)
        .from(segmentSeat)
        .where(and(eq(segmentSeat.planId, planId), liveSeat))
        .orderBy(asc(segmentSeat.ordinal), asc(segmentSeat.id)),
      db
        .select({
          id: seatAssignment.id,
          segmentSeatId: seatAssignment.segmentSeatId,
          occupantType: seatAssignment.occupantType,
          segmentMemberId: seatAssignment.segmentMemberId,
          // 个人继续暴露进入环节时的团体快照；团体占位则读分配行目标。
          organizationId: sql<number | null>`coalesce(
            ${seatAssignment.organizationId},
            ${segmentMember.organizationId}
          )`
            .mapWith(segmentMember.organizationId)
            .as("organization_id"),
          organizationName: organization.name,
          memberName: member.name,
          companyPosition: member.companyPosition,
        })
        .from(seatAssignment)
        .leftJoin(
          segmentMember,
          eq(segmentMember.id, seatAssignment.segmentMemberId),
        )
        .leftJoin(member, eq(member.id, segmentMember.memberId))
        .leftJoin(
          organization,
          eq(
            organization.id,
            sql`coalesce(${seatAssignment.organizationId}, ${segmentMember.organizationId})`,
          ),
        )
        .where(and(eq(seatAssignment.planId, planId), liveAssignment)),
    ]);

    return c.json(ok({ plan, layout, seats, assignments }));
  })

  /**
   * 可以排进这个方案的人：只返回已经关联当前环节的人员。
   *
   * 排位方案按环节隔离，不能把同一活动中只参加其他环节的人员混进当前方案。
   * 需要新增当前环节人员时，应先在环节人员管理中建立关系，再回到这里排位。
   *
   * 已占座的人标出来但不过滤掉：让人看见"他已经在 A3"比让他凭空消失有用。
   */
  .post("/listCandidates", jsonBody(ListCandidatesInput), async (c) => {
    const { planId, keyword } = c.req.valid("json");

    const [plan] = await db
      .select({
        segmentId: segmentSeatingPlan.segmentId,
        activityId: segmentSeatingPlan.activityId,
      })
      .from(segmentSeatingPlan)
      .where(eq(segmentSeatingPlan.id, planId));
    if (!plan) return c.json(notFound());

    const rows = await listCandidatesQuery(planId, plan, keyword);

    return c.json(ok({ list: rows }));
  })

  /**
   * 可以作为团体占位的团体：只读当前方案环节的 organizationId 范围快照。
   *
   * 这是轻量选择器，不返回人数、也不创建任何人员关系；团体统计和批量占位分别
   * 走下方的专用接口，不能借这条接口隐式写入。
   */
  .post("/listOrganizationCandidates", jsonBody(PlanIdInput), async (c) => {
    const { planId } = c.req.valid("json");

    const [plan] = await db
      .select({ segmentId: segmentSeatingPlan.segmentId })
      .from(segmentSeatingPlan)
      .where(eq(segmentSeatingPlan.id, planId));
    if (!plan) return c.json(notFound());

    const list = await listOrganizationCandidatesQuery(plan.segmentId);
    return c.json(ok({ list }));
  })

  /**
   * 当前方案环节内的团体排位统计。颜色只给稳定色板槽位，人数则把个人排座和
   * 团体占位明确拆开：团体占几个位置，不会假装有几个具体成员已入座。
   */
  .post("/listOrganizationStats", jsonBody(PlanIdInput), async (c) => {
    const { planId } = c.req.valid("json");

    const [plan] = await db
      .select({ segmentId: segmentSeatingPlan.segmentId })
      .from(segmentSeatingPlan)
      .where(eq(segmentSeatingPlan.id, planId));
    if (!plan) return c.json(notFound());

    const rows = await listOrganizationSeatingStatsQuery(
      db,
      planId,
      plan.segmentId,
    );
    return c.json(ok({ list: withOrganizationSeatingStats(rows) }));
  })

  /**
   * 建方案。第一次保存直接建 `pending` 的行，没有草稿态（BR-DEV-010）。
   *
   * 座位由前端投影好传进来——活动区域的座位在那份不透明 blob 里，只有前端的
   * 编辑器认识它。服务端不解析 blob，这条在这里也一样。
   */
  .post("/createPlan", jsonBody(CreatePlanInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [segment] = await tx
        .select({
          activityId: activitySegment.activityId,
          status: activitySegment.status,
          seatingEnabled: activitySegment.seatingEnabled,
        })
        .from(activitySegment)
        .where(eq(activitySegment.id, input.segmentId));
      if (!segment) return { ok: false as const, error: "环节不存在" };
      if (segment.status === "voided") {
        return { ok: false as const, error: "环节已作废，不能新建排位" };
      }
      if (!segment.seatingEnabled) {
        return { ok: false as const, error: "该环节没有开启排位" };
      }

      const [zone] = await tx
        .select({
          activityId: activityVenueZone.activityId,
          status: activityVenueZone.status,
        })
        .from(activityVenueZone)
        .where(eq(activityVenueZone.id, input.activityVenueZoneId));
      if (!zone) return { ok: false as const, error: "活动区域不存在" };
      if (zone.activityId !== segment.activityId) {
        return { ok: false as const, error: "该区域不属于本活动" };
      }
      if (zone.status === "disabled") {
        return { ok: false as const, error: "该区域已在本活动停用" };
      }

      const [existing] = await tx
        .select({ id: segmentSeatingPlan.id })
        .from(segmentSeatingPlan)
        .where(
          and(
            eq(segmentSeatingPlan.segmentId, input.segmentId),
            sql`${segmentSeatingPlan.status} <> 'voided'`,
          ),
        );
      if (existing) {
        return { ok: false as const, error: "这个环节已经有排位方案了" };
      }

      const [plan] = await tx
        .insert(segmentSeatingPlan)
        .values({
          segmentId: input.segmentId,
          activityId: segment.activityId,
          activityVenueZoneId: input.activityVenueZoneId,
          status: "pending",
          savedBy: userId,
          savedAt: new Date(),
        })
        .returning(planFields);
      if (!plan) return { ok: false as const, error: "创建失败" };

      await tx.insert(segmentSeatingLayout).values({
        planId: plan.id,
        rendererKind: input.layout.rendererKind,
        rendererVersion: input.layout.rendererVersion,
        data: input.layout.data,
        updatedBy: userId,
      });

      if (input.seats.length) {
        await tx.insert(segmentSeat).values(
          input.seats.map((seat) => ({
            planId: plan.id,
            externalId: seat.externalId,
            sourceExternalId: seat.sourceExternalId ?? null,
            label: seat.label,
            kind: seat.kind,
            rank: seat.rank,
            enabled: seat.enabled,
            ordinal: seat.ordinal,
          })),
        );
      }

      await writeLog(tx, plan.id, "saveLayout", userId, {
        created: true,
        seats: input.seats.length,
      });

      return { ok: true as const, plan, seats: input.seats.length };
    });

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok({ plan: result.plan, seats: result.seats }));
  })

  /**
   * 画布保存。**请求体里没有人**（§3.2）。
   *
   * 位置消失或被禁用而上面有人时，整次保存被拒，返回 `ok({ applied: false,
   * blocked })` 而不是 `err(...)`——信封里的 ApiError 只有 code + message，
   * 塞不下结构化清单；而且这不是错误，是一个正常的业务结果（"这次没保存，
   * 因为这些位置上有人"）。为它扩信封会污染所有模块的返回类型。
   */
  .post("/saveLayout", jsonBody(SavePlanLayoutInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx
        .select({
          id: segmentSeatingPlan.id,
          status: segmentSeatingPlan.status,
        })
        .from(segmentSeatingPlan)
        .where(eq(segmentSeatingPlan.id, input.planId));
      if (!plan) return { kind: "notFound" as const };
      if (!isWritable(plan.status)) {
        return { kind: "invalid" as const, error: "方案已作废，不能再修改" };
      }

      const rows: PlanSeatRow[] = await tx
        .select(seatFields)
        .from(segmentSeat)
        .where(and(eq(segmentSeat.planId, input.planId), liveSeat));

      const occupied = await occupiedSeats(tx, input.planId);
      const merged = planSeatMerge(rows, input.seats, occupied);

      // 一条都不落地：blocked 非空说明这次保存会让某个人失去座位。
      if (merged.blocked.length) {
        return { kind: "blocked" as const, blocked: merged.blocked };
      }

      if (merged.remove.length) {
        // 软删而不是物理删——这些行被 seat_assignment 引用（哪怕是已撤销的）。
        await tx
          .update(segmentSeat)
          .set({ removedAt: new Date() })
          .where(inArray(segmentSeat.id, merged.remove));
      }
      for (const { id, draft } of merged.update) {
        await tx
          .update(segmentSeat)
          .set({
            label: draft.label,
            kind: draft.kind,
            rank: draft.rank,
            enabled: draft.enabled,
            ordinal: draft.ordinal,
          })
          .where(eq(segmentSeat.id, id));
      }
      if (merged.insert.length) {
        await tx.insert(segmentSeat).values(
          merged.insert.map((seat) => ({
            planId: input.planId,
            externalId: seat.externalId,
            sourceExternalId: seat.sourceExternalId ?? null,
            label: seat.label,
            kind: seat.kind,
            rank: seat.rank,
            enabled: seat.enabled,
            ordinal: seat.ordinal,
          })),
        );
      }

      await tx
        .update(segmentSeatingLayout)
        .set({
          rendererKind: input.layout.rendererKind,
          rendererVersion: input.layout.rendererVersion,
          data: input.layout.data,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(segmentSeatingLayout.planId, input.planId));

      const { wasConfirmed } = await touchPlan(tx, input.planId, userId);
      await writeLog(tx, input.planId, "saveLayout", userId, {
        added: merged.insert.length,
        updated: merged.update.length,
        removed: merged.remove.length,
      });

      return {
        kind: "ok" as const,
        wasConfirmed,
        counts: {
          added: merged.insert.length,
          updated: merged.update.length,
          removed: merged.remove.length,
        },
      };
    });

    if (result.kind === "notFound") return c.json(notFound());
    if (result.kind === "invalid") return c.json(invalid(result.error));
    if (result.kind === "blocked") {
      return c.json(ok({ applied: false as const, blocked: result.blocked }));
    }
    return c.json(
      ok({
        applied: true as const,
        seats: result.counts,
        wasConfirmed: result.wasConfirmed,
      }),
    );
  })

  /** 排一个环节人员到某个座位。 */
  .post("/assign", jsonBody(AssignInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) =>
      assignSeat(tx, {
        planId: input.planId,
        segmentSeatId: input.segmentSeatId,
        segmentMemberId: input.segmentMemberId,
        userId,
      }),
    );

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok(result.data));
  })

  /**
   * 将当前方案环节范围内的一个团体占到某个位置。
   *
   * 团体是位置的占用对象，不会补建或伪造任何 segment_member；同一团体可占多
   * 个位置，只有个人路径受“同方案一人一座”限制。
   */
  .post("/assignOrganization", jsonBody(AssignOrganizationInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction((tx) =>
      assignOrganizationSeat(tx, { ...input, userId }),
    );

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok(result.data));
  })

  /**
   * 按传入的有序位置 id 预览团体批量占位。只报告可用、跳过和不足，**绝不写库**；
   * `targetMode: remaining` 使用尚未个人排座的人数，`custom` 则使用正整数目标。
   */
  .post(
    "/previewOrganizationBatch",
    jsonBody(OrganizationSeatBatchInput),
    async (c) => {
      const input = c.req.valid("json");

      const result = await db.transaction((tx) =>
        organizationSeatPreview(tx, input),
      );

      if (result.kind === "notFound") return c.json(notFound());
      if (result.kind === "invalid") return c.json(invalid(result.error));
      return c.json(
        ok({
          organization: result.stats,
          targetCount: result.targetCount,
          preview: result.preview,
        }),
      );
    },
  )

  /**
   * 事务化写入团体批量占位。只插入预览中启用且空闲的位置，从不撤销或覆盖现有
   * 个人/团体；任一位置不足时整批不写。调用方应先用预览接口向用户展示跳过项。
   */
  .post(
    "/assignOrganizationBatch",
    jsonBody(OrganizationSeatBatchInput),
    async (c) => {
      const input = c.req.valid("json");
      const userId = c.get("authedUser").id;

      let result:
        | {
            kind: "notFound";
          }
        | {
            kind: "invalid";
            error: string;
          }
        | {
            kind: "insufficient";
            organization: ReturnType<
              typeof withOrganizationSeatingStats
            >[number];
            targetCount: number;
            preview: ReturnType<typeof planOrganizationSeatAssignments>;
          }
        | {
            kind: "ok";
            organization: ReturnType<
              typeof withOrganizationSeatingStats
            >[number];
            targetCount: number;
            seatIds: number[];
            wasConfirmed: boolean;
          };

      try {
        result = await db.transaction(async (tx) => {
          const checked = await organizationSeatPreview(tx, input);
          if (checked.kind !== "ok") return checked;

          if (checked.preview.insufficient > 0) {
            return {
              kind: "insufficient" as const,
              organization: checked.stats,
              targetCount: checked.targetCount,
              preview: checked.preview,
            };
          }

          // `remaining` 可以自然算出 0；这种操作没有任何写入，也就不碰方案时间
          // 或日志，避免把无变化的点击伪装成一次排位修改。
          if (!checked.preview.plannedSeatIds.length) {
            return {
              kind: "ok" as const,
              organization: checked.stats,
              targetCount: checked.targetCount,
              seatIds: [],
              wasConfirmed: false,
            };
          }

          await tx.insert(seatAssignment).values(
            checked.preview.plannedSeatIds.map((segmentSeatId) => ({
              planId: input.planId,
              segmentId: checked.plan.segmentId,
              segmentSeatId,
              occupantType: "organization" as const,
              segmentMemberId: null,
              organizationId: input.organizationId,
              assignedBy: userId,
            })),
          );

          const { wasConfirmed } = await touchPlan(tx, input.planId, userId);
          await writeLog(tx, input.planId, "assign", userId, {
            batch: true,
            occupantType: "organization",
            organizationId: input.organizationId,
            targetCount: checked.targetCount,
            seatIds: checked.preview.plannedSeatIds,
          });

          return {
            kind: "ok" as const,
            organization: checked.stats,
            targetCount: checked.targetCount,
            seatIds: checked.preview.plannedSeatIds,
            wasConfirmed,
          };
        });
      } catch (error) {
        // 预览后如果另一个操作者抢先占走了某位置，partial unique 会让整条
        // INSERT 回滚；把它翻成可重试的业务错误，而不是暴露 PostgreSQL 细节。
        if (hasDatabaseCode(error, "23505")) {
          return c.json(invalid("可用位置已变化，请重新预览后再提交"));
        }
        throw error;
      }

      if (result.kind === "notFound") return c.json(notFound());
      if (result.kind === "invalid") return c.json(invalid(result.error));
      if (result.kind === "insufficient") {
        return c.json(
          ok({
            applied: false as const,
            organization: result.organization,
            targetCount: result.targetCount,
            preview: result.preview,
          }),
        );
      }
      return c.json(
        ok({
          applied: true as const,
          organization: result.organization,
          targetCount: result.targetCount,
          seatIds: result.seatIds,
          wasConfirmed: result.wasConfirmed,
        }),
      );
    },
  )

  /**
   * 兼容旧客户端：排一个**还不是本环节人员**的活动人员，先补一条
   * `segment_member`，再建分配。
   *
   * 当前 Web 管理端只展示当前环节人员，不再调用这个入口。
   *
   * 环节人员开关是关的也照补——那个开关本期只是声明（agenda/schema.ts 的原话：
   * "没有下游功能接上"），不影响排位能不能建关系。
   */
  .post(
    "/assignActivityMember",
    jsonBody(AssignActivityMemberInput),
    async (c) => {
      const input = c.req.valid("json");
      const userId = c.get("authedUser").id;

      const result = await db.transaction(async (tx) => {
        const [plan] = await tx
          .select({
            segmentId: segmentSeatingPlan.segmentId,
            activityId: segmentSeatingPlan.activityId,
            status: segmentSeatingPlan.status,
          })
          .from(segmentSeatingPlan)
          .where(eq(segmentSeatingPlan.id, input.planId));
        if (!plan) return { ok: false as const, error: "排位方案不存在" };

        const [am] = await tx
          .select({
            id: activityMember.id,
            activityId: activityMember.activityId,
            memberId: activityMember.memberId,
            organizationId: activityMember.organizationId,
          })
          .from(activityMember)
          .where(eq(activityMember.id, input.activityMemberId));
        if (!am) return { ok: false as const, error: "活动人员不存在" };
        if (am.activityId !== plan.activityId) {
          return { ok: false as const, error: "该人员不属于本活动" };
        }

        // 三个关系字段和 segmentRole 均留空走既有继承约定；团体快照的继承、
        // 冲突保留和并发去重统一由 ladder 处理。
        const segmentMemberId = await ensureSegmentMemberFromActivity(tx, {
          segmentId: plan.segmentId,
          activityMember: am,
          originType: "manual",
          userId,
        });

        return assignSeat(tx, {
          planId: input.planId,
          segmentSeatId: input.segmentSeatId,
          segmentMemberId,
          userId,
        });
      });

      if (!result.ok) return c.json(invalid(result.error));
      return c.json(ok(result.data));
    },
  )

  .post("/unassign", jsonBody(UnassignInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx
        .select({ status: segmentSeatingPlan.status })
        .from(segmentSeatingPlan)
        .where(eq(segmentSeatingPlan.id, input.planId));
      if (!plan) return { ok: false as const, error: "排位方案不存在" };
      if (!isWritable(plan.status)) {
        return { ok: false as const, error: "方案已作废，不能再修改" };
      }

      const [revoked] = await tx
        .update(seatAssignment)
        .set({ revokedBy: userId, revokedAt: new Date() })
        .where(
          and(
            eq(seatAssignment.planId, input.planId),
            eq(seatAssignment.segmentSeatId, input.segmentSeatId),
            liveAssignment,
          ),
        )
        .returning({
          id: seatAssignment.id,
          occupantType: seatAssignment.occupantType,
          segmentMemberId: seatAssignment.segmentMemberId,
          organizationId: seatAssignment.organizationId,
        });
      if (!revoked) return { ok: false as const, error: "这个位置上没有人" };

      const { wasConfirmed } = await touchPlan(tx, input.planId, userId);
      await writeLog(tx, input.planId, "unassign", userId, {
        seatId: input.segmentSeatId,
        occupantType: revoked.occupantType,
        segmentMemberId: revoked.segmentMemberId,
        organizationId: revoked.organizationId,
      });

      return { ok: true as const, data: { wasConfirmed } };
    });

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok(result.data));
  })

  /**
   * 解除某团体在当前方案的全部有效占位。个人分配和其他团体的占位都不在更新条件
   * 内；一条批量日志对应这一次明确的“全部解除”操作。
   */
  .post(
    "/unassignOrganization",
    jsonBody(UnassignOrganizationInput),
    async (c) => {
      const input = c.req.valid("json");
      const userId = c.get("authedUser").id;

      const result = await db.transaction(async (tx) => {
        const [plan] = await tx
          .select({ status: segmentSeatingPlan.status })
          .from(segmentSeatingPlan)
          .where(eq(segmentSeatingPlan.id, input.planId));
        if (!plan) return { kind: "notFound" as const };
        if (!isWritable(plan.status)) {
          return { kind: "invalid" as const, error: "方案已作废，不能再修改" };
        }

        const revoked = await tx
          .update(seatAssignment)
          .set({ revokedBy: userId, revokedAt: new Date() })
          .where(
            and(
              eq(seatAssignment.planId, input.planId),
              eq(seatAssignment.occupantType, "organization"),
              eq(seatAssignment.organizationId, input.organizationId),
              liveAssignment,
            ),
          )
          .returning({ seatId: seatAssignment.segmentSeatId });
        if (!revoked.length) {
          return {
            kind: "invalid" as const,
            error: "该团体在当前方案没有占位",
          };
        }

        const { wasConfirmed } = await touchPlan(tx, input.planId, userId);
        const seatIds = revoked.map((row) => row.seatId);
        await writeLog(tx, input.planId, "unassign", userId, {
          batch: true,
          occupantType: "organization",
          organizationId: input.organizationId,
          seatIds,
        });
        return { kind: "ok" as const, seatIds, wasConfirmed };
      });

      if (result.kind === "notFound") return c.json(notFound());
      if (result.kind === "invalid") return c.json(invalid(result.error));
      return c.json(
        ok({ seatIds: result.seatIds, wasConfirmed: result.wasConfirmed }),
      );
    },
  )

  /**
   * 本环节启用/停用一个位置。**即时生效，独立于画布保存**——排位阶段不再允许
   * 编辑几何（`saveLayout` 已经从前端的排位画布上撤下来了），启用/停用是业务
   * 状态不是几何，所以单独留一条即时写路径，跟 assign/unassign 是同一类操作。
   *
   * 有人坐的位置不能停用，检查方式跟 `saveLayout` 的 blocked 校验同一条规则
   * （§5"禁用已分配位置也要拦"）：只是这里只有一个位置要查，不需要走整份
   * `planSeatMerge`，直接查一次占座人就够了。
   */
  .post("/setSeatEnabled", jsonBody(SetSeatEnabledInput), async (c) => {
    const { planId, segmentSeatId, enabled } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx
        .select({ status: segmentSeatingPlan.status })
        .from(segmentSeatingPlan)
        .where(eq(segmentSeatingPlan.id, planId));
      if (!plan) return { kind: "notFound" as const };
      if (!isWritable(plan.status)) {
        return { kind: "invalid" as const, error: "方案已作废，不能再修改" };
      }

      const [seat] = await tx
        .select({
          id: segmentSeat.id,
          label: segmentSeat.label,
          enabled: segmentSeat.enabled,
        })
        .from(segmentSeat)
        .where(
          and(
            eq(segmentSeat.id, segmentSeatId),
            eq(segmentSeat.planId, planId),
            liveSeat,
          ),
        );
      if (!seat) return { kind: "invalid" as const, error: "位置不存在" };

      if (seat.enabled && !enabled) {
        const [occupant] = await tx
          .select({
            name: sql<string>`case
              when ${seatAssignment.occupantType} = 'organization'
                then concat('团体：', ${organization.name})
              else ${member.name}
            end`.as("occupant_name"),
          })
          .from(seatAssignment)
          .leftJoin(
            segmentMember,
            eq(segmentMember.id, seatAssignment.segmentMemberId),
          )
          .leftJoin(member, eq(member.id, segmentMember.memberId))
          .leftJoin(
            organization,
            eq(organization.id, seatAssignment.organizationId),
          )
          .where(
            and(
              eq(seatAssignment.planId, planId),
              eq(seatAssignment.segmentSeatId, segmentSeatId),
              liveAssignment,
            ),
          );
        if (occupant) {
          return {
            kind: "blocked" as const,
            blocked: [
              {
                seatId: seat.id,
                label: seat.label,
                memberName: occupant.name,
                reason: "disabled" as const,
              },
            ],
          };
        }
      }

      await tx
        .update(segmentSeat)
        .set({ enabled })
        .where(eq(segmentSeat.id, segmentSeatId));

      const { wasConfirmed } = await touchPlan(tx, planId, userId);
      await writeLog(tx, planId, "saveLayout", userId, {
        seatId: segmentSeatId,
        enabled,
      });

      return { kind: "ok" as const, wasConfirmed };
    });

    if (result.kind === "notFound") return c.json(notFound());
    if (result.kind === "invalid") return c.json(invalid(result.error));
    if (result.kind === "blocked") {
      return c.json(ok({ applied: false as const, blocked: result.blocked }));
    }
    return c.json(
      ok({ applied: true as const, wasConfirmed: result.wasConfirmed }),
    );
  })

  /**
   * 两个座位上的人对调。
   *
   * 不是"解绑两次再分配两次"：那样中间会短暂出现一个人没座位的状态，而且
   * 一人一座的唯一索引会在中间步骤上炸。这里先把两条都撤销，再插两条新的，
   * 全在一个事务里。MVP 对个人/团体一视同仁：任何有效占用对象均随位置交换；
   * 团体不会被展开成成员，个人的一人一座约束仍由 partial unique 保证。
   */
  .post("/swap", jsonBody(SwapInput), async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("authedUser").id;

    if (input.seatAId === input.seatBId) {
      return c.json(invalid("不能和自己对调"));
    }

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx
        .select({
          segmentId: segmentSeatingPlan.segmentId,
          status: segmentSeatingPlan.status,
        })
        .from(segmentSeatingPlan)
        .where(eq(segmentSeatingPlan.id, input.planId));
      if (!plan) return { ok: false as const, error: "排位方案不存在" };
      if (!isWritable(plan.status)) {
        return { ok: false as const, error: "方案已作废，不能再修改" };
      }

      const targetSeats = await tx
        .select({
          id: segmentSeat.id,
          label: segmentSeat.label,
          enabled: segmentSeat.enabled,
          removedAt: segmentSeat.removedAt,
        })
        .from(segmentSeat)
        .where(
          and(
            eq(segmentSeat.planId, input.planId),
            inArray(segmentSeat.id, [input.seatAId, input.seatBId]),
          ),
        );
      if (
        targetSeats.length !== 2 ||
        targetSeats.some((seat) => seat.removedAt)
      ) {
        return { ok: false as const, error: "位置不存在" };
      }
      if (targetSeats.some((seat) => !seat.enabled)) {
        return { ok: false as const, error: "停用的位置不能参与对调" };
      }

      const current = await tx
        .select({
          id: seatAssignment.id,
          seatId: seatAssignment.segmentSeatId,
          occupantType: seatAssignment.occupantType,
          segmentMemberId: seatAssignment.segmentMemberId,
          // 确认日志必须保留既有个人座位的团体快照，不能因新增团体占位而丢失。
          organizationId: sql<number | null>`coalesce(
            ${seatAssignment.organizationId},
            ${segmentMember.organizationId}
          )`
            .mapWith(segmentMember.organizationId)
            .as("organization_id"),
        })
        .from(seatAssignment)
        .where(
          and(
            eq(seatAssignment.planId, input.planId),
            inArray(seatAssignment.segmentSeatId, [
              input.seatAId,
              input.seatBId,
            ]),
            liveAssignment,
          ),
        );

      if (current.length === 0) {
        return { ok: false as const, error: "两个位置上都没有人" };
      }

      await tx
        .update(seatAssignment)
        .set({ revokedBy: userId, revokedAt: new Date() })
        .where(
          inArray(
            seatAssignment.id,
            current.map((row) => row.id),
          ),
        );

      // 只有一边有人时，对调退化成"把这个人挪到另一个位置"，是合理语义。
      const swapped = swapAssignmentSeats(
        current,
        input.seatAId,
        input.seatBId,
      ).map((row) => ({
        planId: input.planId,
        segmentId: plan.segmentId,
        segmentSeatId: row.seatId,
        occupantType: row.occupantType,
        segmentMemberId: row.segmentMemberId,
        organizationId: row.organizationId,
        assignedBy: userId,
      }));
      await tx.insert(seatAssignment).values(swapped);

      const { wasConfirmed } = await touchPlan(tx, input.planId, userId);
      await writeLog(tx, input.planId, "swap", userId, {
        seatAId: input.seatAId,
        seatBId: input.seatBId,
        occupants: current.map((row) => ({
          seatId: row.seatId,
          occupantType: row.occupantType,
          segmentMemberId: row.segmentMemberId,
          organizationId: row.organizationId,
        })),
      });

      return { ok: true as const, data: { wasConfirmed } };
    });

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok(result.data));
  })

  /**
   * 确认发布。
   *
   * 校验是**逐条的，不是比数量**（§7）：每条生效分配指向的位置必须仍然未软删
   * 且启用。只比数量会漏掉"人坐在一个已禁用位置上"——A 已分配、B 空着，把 A
   * 禁用后"启用数 1 ≥ 分配数 1"照样成立。
   *
   * `capacity` 超出**只提示不阻断**：它是活动层的规划数字，不是权威座位集合。
   */
  .post("/confirm", jsonBody(ConfirmPlanInput), async (c) => {
    const { planId } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx
        .select({
          status: segmentSeatingPlan.status,
          version: segmentSeatingPlan.version,
          capacity: activityVenueZone.capacity,
          segmentStatus: activitySegment.status,
          segmentName: activitySegment.name,
        })
        .from(segmentSeatingPlan)
        .innerJoin(
          activityVenueZone,
          eq(activityVenueZone.id, segmentSeatingPlan.activityVenueZoneId),
        )
        .innerJoin(
          activitySegment,
          eq(activitySegment.id, segmentSeatingPlan.segmentId),
        )
        .where(eq(segmentSeatingPlan.id, planId));
      if (!plan) return { kind: "notFound" as const };
      if (plan.status === "voided") {
        return { kind: "invalid" as const, error: "方案已作废" };
      }
      if (plan.status === "confirmed") {
        return { kind: "invalid" as const, error: "方案已经是已确认状态" };
      }
      /**
       * 作废的环节不能再确认排位。BR-DEV-003B：环节作废后"不进入新排位、
       * 不进入座位通知"——`createPlan` 早就挡了前半句，后半句一直没有落点，
       * 于是一个已作废环节的方案照样能点确认、照样会生成通知（评审 §3.5）。
       */
      if (plan.segmentStatus === "voided") {
        return {
          kind: "invalid" as const,
          error: `环节「${plan.segmentName}」已作废，不能确认它的排位`,
        };
      }

      const seats = await tx
        .select({
          id: segmentSeat.id,
          label: segmentSeat.label,
          kind: segmentSeat.kind,
          rank: segmentSeat.rank,
          enabled: segmentSeat.enabled,
          removedAt: segmentSeat.removedAt,
        })
        .from(segmentSeat)
        .where(eq(segmentSeat.planId, planId));

      const assignments = await tx
        .select({
          seatId: seatAssignment.segmentSeatId,
          occupantType: seatAssignment.occupantType,
          segmentMemberId: seatAssignment.segmentMemberId,
          organizationId: sql<number | null>`coalesce(
            ${seatAssignment.organizationId},
            ${segmentMember.organizationId}
          )`
            .mapWith(segmentMember.organizationId)
            .as("organization_id"),
          organizationName: organization.name,
          memberId: member.id,
          memberName: member.name,
          mobile: member.mobile,
          occupantName: sql<string>`case
            when ${seatAssignment.occupantType} = 'organization'
              then concat('团体：', ${organization.name})
            else ${member.name}
          end`.as("occupant_name"),
        })
        .from(seatAssignment)
        .leftJoin(
          segmentMember,
          eq(segmentMember.id, seatAssignment.segmentMemberId),
        )
        .leftJoin(member, eq(member.id, segmentMember.memberId))
        .leftJoin(
          organization,
          eq(
            organization.id,
            sql`coalesce(${seatAssignment.organizationId}, ${segmentMember.organizationId})`,
          ),
        )
        .where(and(eq(seatAssignment.planId, planId), liveAssignment));

      const seatById = new Map(
        seats.map((seat) => [
          seat.id,
          {
            label: seat.label,
            enabled: seat.enabled,
            removed: seat.removedAt !== null,
          },
        ]),
      );
      const blocked = findInvalidAssignments(assignments, seatById);
      if (blocked.length) return { kind: "blocked" as const, blocked };

      const version = plan.version + 1;
      await tx
        .update(segmentSeatingPlan)
        .set({
          status: "confirmed",
          version,
          confirmedBy: userId,
          confirmedAt: new Date(),
          rejectedReason: null,
        })
        .where(eq(segmentSeatingPlan.id, planId));

      /**
       * payload 装**完整快照**（位置 + 分配 + 当时的编号）。
       *
       * 座位通知名单和历史编号都从这份快照读，不依赖当前的分配行——确认之后
       * 分配还会继续变，那时再去查"当初通知的是谁、座位叫什么"就已经晚了。
       */
      await writeLog(tx, planId, "confirm", userId, {
        version,
        seats: seats
          .filter((seat) => seat.removedAt === null && seat.enabled)
          .map((seat) => ({
            id: seat.id,
            label: seat.label,
            kind: seat.kind,
            rank: seat.rank,
          })),
        assignments: assignments.map((row) => ({
          seatId: row.seatId,
          seatLabel: seatById.get(row.seatId)?.label ?? null,
          occupantType: row.occupantType,
          segmentMemberId: row.segmentMemberId,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          memberId: row.memberId,
          memberName: row.memberName,
          mobile: row.mobile,
        })),
      });

      const activeSeats = seats.filter(
        (seat) => seat.removedAt === null && seat.enabled,
      ).length;

      return {
        kind: "ok" as const,
        version,
        assigned: assignments.length,
        // 只提示，不阻断。
        overCapacity:
          plan.capacity > 0 && activeSeats > plan.capacity
            ? { capacity: plan.capacity, seats: activeSeats }
            : null,
      };
    });

    if (result.kind === "notFound") return c.json(notFound());
    if (result.kind === "invalid") return c.json(invalid(result.error));
    if (result.kind === "blocked") {
      return c.json(ok({ applied: false as const, blocked: result.blocked }));
    }
    return c.json(
      ok({
        applied: true as const,
        version: result.version,
        assigned: result.assigned,
        overCapacity: result.overCapacity,
      }),
    );
  })

  .post("/reject", jsonBody(RejectPlanInput), async (c) => {
    const { planId, reason } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx
        .select({ status: segmentSeatingPlan.status })
        .from(segmentSeatingPlan)
        .where(eq(segmentSeatingPlan.id, planId));
      if (!plan) return { ok: false as const, error: "排位方案不存在" };
      if (plan.status !== "pending") {
        return { ok: false as const, error: "只有待确认的方案可以退回" };
      }

      await tx
        .update(segmentSeatingPlan)
        .set({ status: "rejected", rejectedReason: reason })
        .where(eq(segmentSeatingPlan.id, planId));
      await writeLog(tx, planId, "reject", userId, { reason });

      return { ok: true as const };
    });

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok({ planId }));
  })

  .post("/void", jsonBody(VoidPlanInput), async (c) => {
    const { planId } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(async (tx) => {
      const [plan] = await tx
        .select({ status: segmentSeatingPlan.status })
        .from(segmentSeatingPlan)
        .where(eq(segmentSeatingPlan.id, planId));
      if (!plan) return { ok: false as const, error: "排位方案不存在" };
      if (plan.status === "voided") {
        return { ok: false as const, error: "方案已经作废了" };
      }

      /**
       * 作废时把生效分配一起撤掉。不撤的话，那些行会一直满足"一人一座"的
       * 唯一索引，导致这个人在新方案里排不进任何位置——而作废的语义就是
       * "这份排位不再作数"。
       */
      await tx
        .update(seatAssignment)
        .set({ revokedBy: userId, revokedAt: new Date() })
        .where(and(eq(seatAssignment.planId, planId), liveAssignment));

      await tx
        .update(segmentSeatingPlan)
        .set({ status: "voided" })
        .where(eq(segmentSeatingPlan.id, planId));
      await writeLog(tx, planId, "void", userId);

      return { ok: true as const };
    });

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok({ planId }));
  });

/**
 * 建个人分配。`assign` 和 `assignActivityMember` 共用——后者只是先补一条环节
 * 人员，落分配这一步完全一样。
 */
async function assignSeat(
  tx: Tx,
  input: {
    planId: number;
    segmentSeatId: number;
    segmentMemberId: number;
    userId: string;
  },
) {
  return assignOccupant(tx, {
    ...input,
    occupantType: "person",
    organizationId: null,
  });
}

/** 团体占位不创建任何人员关系，只把真实环节范围内的团体作为占用对象落库。 */
async function assignOrganizationSeat(
  tx: Tx,
  input: {
    planId: number;
    segmentSeatId: number;
    organizationId: number;
    userId: string;
  },
) {
  return assignOccupant(tx, {
    ...input,
    occupantType: "organization",
    segmentMemberId: null,
  });
}

type SeatOccupantInput =
  | {
      occupantType: "person";
      segmentMemberId: number;
      organizationId: null;
    }
  | {
      occupantType: "organization";
      segmentMemberId: null;
      organizationId: number;
    };

/**
 * 两种占用对象共用的落库路径。团体没有“一团一座”限制；个人则在撤旧后由
 * partial unique 兜底“一方案一人一座”。范围校验放在插入前，避免把数据库
 * 外键异常暴露成 500。
 */
async function assignOccupant(
  tx: Tx,
  input: SeatOccupantInput & {
    planId: number;
    segmentSeatId: number;
    userId: string;
  },
) {
  const [plan] = await tx
    .select({
      segmentId: segmentSeatingPlan.segmentId,
      status: segmentSeatingPlan.status,
    })
    .from(segmentSeatingPlan)
    .where(eq(segmentSeatingPlan.id, input.planId));
  if (!plan) return { ok: false as const, error: "排位方案不存在" };
  if (!isWritable(plan.status)) {
    return { ok: false as const, error: "方案已作废，不能再修改" };
  }

  const [seat] = await tx
    .select({
      id: segmentSeat.id,
      label: segmentSeat.label,
      enabled: segmentSeat.enabled,
      removedAt: segmentSeat.removedAt,
    })
    .from(segmentSeat)
    .where(
      and(
        eq(segmentSeat.id, input.segmentSeatId),
        eq(segmentSeat.planId, input.planId),
      ),
    );
  if (!seat || seat.removedAt !== null) {
    return { ok: false as const, error: "位置不存在" };
  }
  if (!seat.enabled) {
    return { ok: false as const, error: `位置 ${seat.label} 本环节已停用` };
  }

  if (input.occupantType === "person") {
    const [segmentPerson] = await tx
      .select({ id: segmentMember.id })
      .from(segmentMember)
      .where(
        and(
          eq(segmentMember.id, input.segmentMemberId),
          eq(segmentMember.segmentId, plan.segmentId),
        ),
      );
    if (!segmentPerson) {
      return { ok: false as const, error: "该人员不在当前环节范围内" };
    }
  } else {
    const [segmentOrganization] = await organizationInSegmentScopeQuery(
      tx,
      plan.segmentId,
      input.organizationId,
    );
    if (!segmentOrganization) {
      return { ok: false as const, error: "该团体不在当前环节范围内" };
    }
  }

  // 先撤掉这个位置上的旧占用对象；个人还要撤自己的旧位置，才能在事务中保持
  // 一方案一人一座。团体可占多个位置，绝不能在这里把同团体其他占位误解除。
  await tx
    .update(seatAssignment)
    .set({ revokedBy: input.userId, revokedAt: new Date() })
    .where(
      and(
        eq(seatAssignment.planId, input.planId),
        or(
          eq(seatAssignment.segmentSeatId, input.segmentSeatId),
          input.occupantType === "person"
            ? eq(seatAssignment.segmentMemberId, input.segmentMemberId)
            : undefined,
        ),
        liveAssignment,
      ),
    );

  await tx.insert(seatAssignment).values({
    planId: input.planId,
    segmentId: plan.segmentId,
    segmentSeatId: input.segmentSeatId,
    occupantType: input.occupantType,
    segmentMemberId: input.segmentMemberId,
    organizationId: input.organizationId,
    assignedBy: input.userId,
  });

  const { wasConfirmed } = await touchPlan(tx, input.planId, input.userId);
  await writeLog(tx, input.planId, "assign", input.userId, {
    seatId: input.segmentSeatId,
    occupantType: input.occupantType,
    segmentMemberId: input.segmentMemberId,
    organizationId: input.organizationId,
  });

  return { ok: true as const, data: { wasConfirmed } };
}
