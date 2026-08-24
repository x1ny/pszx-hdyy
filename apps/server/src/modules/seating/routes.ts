import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { activityMember, member, segmentMember } from "../member/schema";
import {
  activityVenue,
  activityVenueLayout,
  activityVenueZone,
} from "../venue/schema";
import {
  findInvalidAssignments,
  isWritable,
  type PlanSeatRow,
  planSeatMerge,
} from "./plan";
import {
  seatAssignment,
  segmentSeat,
  segmentSeatingLayout,
  segmentSeatingLog,
  segmentSeatingPlan,
} from "./schema";
import {
  ActivityIdInput,
  AssignActivityMemberInput,
  AssignInput,
  ConfirmPlanInput,
  CreatePlanInput,
  ListCandidatesInput,
  ListPlansInput,
  PlanIdInput,
  RejectPlanInput,
  SavePlanLayoutInput,
  SetSeatEnabledInput,
  SwapInput,
  UnassignInput,
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

/** 座位 id → 占座人姓名。归并要用它判断"这个位置上有没有人"。 */
async function occupiedSeats(tx: Tx, planId: number) {
  const rows = await tx
    .select({ seatId: seatAssignment.segmentSeatId, name: member.name })
    .from(seatAssignment)
    .innerJoin(
      segmentMember,
      eq(segmentMember.id, seatAssignment.segmentMemberId),
    )
    .innerJoin(member, eq(member.id, segmentMember.memberId))
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
    const { activityId, status } = c.req.valid("json");

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
      // 左连接：没有方案的环节也要出现，那正是"未配置"。作废的方案不算当前
      // 方案，所以连接条件里就把它排除掉——否则一个环节作废重来之后会出现两行。
      .leftJoin(
        segmentSeatingPlan,
        and(
          eq(segmentSeatingPlan.segmentId, activitySegment.id),
          sql`${segmentSeatingPlan.status} <> 'voided'`,
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
      .where(
        and(
          eq(activitySegment.activityId, activityId),
          /**
           * "开关开着" **或** "已经有非作废方案"。
           *
           * 早先这里是硬过滤 `seatingEnabled = true`，把开关当成了列表的筛选
           * 条件。后果是：环节已经排好位，有人回议程页把排位开关一关，这一行
           * 就从列表里消失了——但方案还在库里、还占着"一个环节一个有效方案"的
           * 唯一索引、场地空间页还显示那块区域"被开幕式引用"、那块区域因此
           * 还删不掉。用户看得见后果，却找不到入口去作废它（评审 §3.4）。
           *
           * 开关和方案是两个独立的事实，用前者过滤后者就会漏。改成并集之后，
           * 开关关掉的那一行仍然在列表里，带一个「排位开关已关闭」的芯片和
           * 作废出口。
           */
          or(
            eq(activitySegment.seatingEnabled, true),
            isNotNull(segmentSeatingPlan.id),
          ),
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
          segmentMemberId: seatAssignment.segmentMemberId,
          memberName: member.name,
          companyPosition: member.companyPosition,
        })
        .from(seatAssignment)
        .innerJoin(
          segmentMember,
          eq(segmentMember.id, seatAssignment.segmentMemberId),
        )
        .innerJoin(member, eq(member.id, segmentMember.memberId))
        .where(and(eq(seatAssignment.planId, planId), liveAssignment)),
    ]);

    return c.json(ok({ plan, layout, seats, assignments }));
  })

  /**
   * 可以排进这个方案的人。
   *
   * 两个来源合成一份（§8）：**已经是本环节人员的**直接用；**只是活动人员的**
   * 排上去时系统会自动补一条环节人员再建分配。前端在同一个抽屉里展示，用
   * `segmentMemberId` 是否为空区分——为空的走 `assignActivityMember`。
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

    const rows = await db
      .select({
        activityMemberId: activityMember.id,
        memberId: member.id,
        name: member.name,
        companyPosition: member.companyPosition,
        mobile: member.mobile,
        segmentMemberId: segmentMember.id,
        takenSeatLabel: sql<string | null>`(
          select ${segmentSeat.label} from ${seatAssignment}
          join ${segmentSeat} on ${eq(segmentSeat.id, seatAssignment.segmentSeatId)}
          where ${eq(seatAssignment.segmentMemberId, segmentMember.id)}
            and ${eq(seatAssignment.planId, planId)}
            and ${seatAssignment.revokedAt} is null
          limit 1
        )`.as("taken_seat_label"),
      })
      .from(activityMember)
      .innerJoin(member, eq(member.id, activityMember.memberId))
      .leftJoin(
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

    return c.json(ok({ list: rows }));
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
   * 排一个**还不是本环节人员**的活动人员：先补一条 `segment_member`，再建分配。
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
          })
          .from(activityMember)
          .where(eq(activityMember.id, input.activityMemberId));
        if (!am) return { ok: false as const, error: "活动人员不存在" };
        if (am.activityId !== plan.activityId) {
          return { ok: false as const, error: "该人员不属于本活动" };
        }

        const [existing] = await tx
          .select({ id: segmentMember.id })
          .from(segmentMember)
          .where(
            and(
              eq(segmentMember.segmentId, plan.segmentId),
              eq(segmentMember.activityMemberId, am.id),
            ),
          );

        let segmentMemberId = existing?.id;
        if (!segmentMemberId) {
          const [created] = await tx
            .insert(segmentMember)
            .values({
              segmentId: plan.segmentId,
              activityId: plan.activityId,
              activityMemberId: am.id,
              memberId: am.memberId,
              // 三个可空列留 null 走继承（member/schema.ts 的 COALESCE 约定），
              // segmentRole 也留空——排位不知道这个人在环节里担任什么。
              originType: "manual",
            })
            .returning({ id: segmentMember.id });
          segmentMemberId = created?.id;
        }
        if (!segmentMemberId) {
          return { ok: false as const, error: "补建环节人员失败" };
        }

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
        .returning({ id: seatAssignment.id });
      if (!revoked) return { ok: false as const, error: "这个位置上没有人" };

      const { wasConfirmed } = await touchPlan(tx, input.planId, userId);
      await writeLog(tx, input.planId, "unassign", userId, {
        seatId: input.segmentSeatId,
      });

      return { ok: true as const, data: { wasConfirmed } };
    });

    if (!result.ok) return c.json(invalid(result.error));
    return c.json(ok(result.data));
  })

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
          .select({ name: member.name })
          .from(seatAssignment)
          .innerJoin(
            segmentMember,
            eq(segmentMember.id, seatAssignment.segmentMemberId),
          )
          .innerJoin(member, eq(member.id, segmentMember.memberId))
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
   * 全在一个事务里。
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

      const current = await tx
        .select({
          id: seatAssignment.id,
          seatId: seatAssignment.segmentSeatId,
          segmentMemberId: seatAssignment.segmentMemberId,
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
      const swapped = current.map((row) => ({
        planId: input.planId,
        segmentId: plan.segmentId,
        segmentSeatId:
          row.seatId === input.seatAId ? input.seatBId : input.seatAId,
        segmentMemberId: row.segmentMemberId,
        assignedBy: userId,
      }));
      await tx.insert(seatAssignment).values(swapped);

      const { wasConfirmed } = await touchPlan(tx, input.planId, userId);
      await writeLog(tx, input.planId, "swap", userId, {
        seatAId: input.seatAId,
        seatBId: input.seatBId,
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
          segmentMemberId: seatAssignment.segmentMemberId,
          memberId: member.id,
          memberName: member.name,
          mobile: member.mobile,
        })
        .from(seatAssignment)
        .innerJoin(
          segmentMember,
          eq(segmentMember.id, seatAssignment.segmentMemberId),
        )
        .innerJoin(member, eq(member.id, segmentMember.memberId))
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
          segmentMemberId: row.segmentMemberId,
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
 * 建一条分配。`assign` 和 `assignActivityMember` 共用——后者只是先补了一条
 * 环节人员，落分配这一步完全一样。
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

  // 先撤掉这个位置上的旧人和这个人的旧位置，再插新的。不这么做的话，
  // 两条 partial unique（一座一人、一人一座）会直接把插入打回来，而报错文案
  // 是数据库的，用户看不懂。
  await tx
    .update(seatAssignment)
    .set({ revokedBy: input.userId, revokedAt: new Date() })
    .where(
      and(
        eq(seatAssignment.planId, input.planId),
        or(
          eq(seatAssignment.segmentSeatId, input.segmentSeatId),
          eq(seatAssignment.segmentMemberId, input.segmentMemberId),
        ),
        liveAssignment,
      ),
    );

  await tx.insert(seatAssignment).values({
    planId: input.planId,
    segmentId: plan.segmentId,
    segmentSeatId: input.segmentSeatId,
    segmentMemberId: input.segmentMemberId,
    assignedBy: input.userId,
  });

  const { wasConfirmed } = await touchPlan(tx, input.planId, input.userId);
  await writeLog(tx, input.planId, "assign", input.userId, {
    seatId: input.segmentSeatId,
    segmentMemberId: input.segmentMemberId,
  });

  return { ok: true as const, data: { wasConfirmed } };
}
