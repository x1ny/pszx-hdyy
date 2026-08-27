import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { activitySegment, type SegmentStatus } from "../agenda/schema";
import { listOrganizationSeatsLeavingScope } from "../seating/cascade";
import { seatAssignment, segmentSeat } from "../seating/schema";
import { memberTrip } from "../trip/schema";
import {
  type ActivityMemberSnapshot,
  ensureSegmentMemberFromActivity,
  type Tx,
} from "./ladder";
import { activityMember, segmentMember } from "./schema";

/** 同步请求里的硬校验失败；抛出后由事务负责整批回滚。 */
export class ActivityMemberSegmentSyncError extends Error {}

const fail = (message: string): never => {
  throw new ActivityMemberSegmentSyncError(message);
};

export type ActivitySegmentSyncScope = {
  id: number;
  activityId: number;
  name: string;
  status: SegmentStatus;
  memberEnabled: boolean;
  startTime: Date;
};

export type ExistingSegmentMembership = {
  id: number;
  segmentId: number;
  organizationId: number | null;
};

export type ReadOnlySegmentMembership = {
  segmentMemberId: number;
  segmentId: number;
  segmentName: string;
  reason: "segmentVoided" | "memberManagementDisabled";
};

export type ActivityMemberSegmentSyncPlan = {
  desiredSegmentIds: number[];
  add: ActivitySegmentSyncScope[];
  existing: Array<{
    segmentMemberId: number;
    segmentId: number;
    segmentName: string;
    organizationId: number | null;
  }>;
  remove: Array<{
    segmentMemberId: number;
    segmentId: number;
    segmentName: string;
    organizationId: number | null;
  }>;
  readOnlyRetained: ReadOnlySegmentMembership[];
};

const readOnlyReason = (
  segment: ActivitySegmentSyncScope,
): ReadOnlySegmentMembership["reason"] | undefined => {
  if (segment.status === "voided") return "segmentVoided";
  if (!segment.memberEnabled) return "memberManagementDisabled";
  return undefined;
};

const byAgendaOrder = (
  left: ActivitySegmentSyncScope,
  right: ActivitySegmentSyncScope,
) => left.startTime.getTime() - right.startTime.getTime() || left.id - right.id;

/**
 * 在任何写入和引用检查前先收敛同步计划。
 *
 * `desiredSegmentIds` 只描述当前可编辑范围；既有作废环节、或已关闭人员管理的
 * 环节关系永远进入 `readOnlyRetained`，不会因为客户端看不到它们而被误删。
 */
export function planActivityMemberSegmentSync(input: {
  activityId: number;
  desiredSegmentIds: readonly number[];
  segments: readonly ActivitySegmentSyncScope[];
  memberships: readonly ExistingSegmentMembership[];
}): ActivityMemberSegmentSyncPlan {
  const desiredSegmentIds = [...new Set(input.desiredSegmentIds)];
  const segmentById = new Map(input.segments.map((row) => [row.id, row]));

  const invalidIds = desiredSegmentIds.filter((segmentId) => {
    const segment = segmentById.get(segmentId);
    return !segment || segment.activityId !== input.activityId;
  });
  if (invalidIds.length > 0) {
    fail(
      `环节 ${invalidIds.map((id) => `#${id}`).join("、")} 不存在或不属于当前活动，整次同步未生效`,
    );
  }

  const unavailable = desiredSegmentIds
    .map((segmentId) => segmentById.get(segmentId))
    .filter(
      (segment): segment is ActivitySegmentSyncScope =>
        segment !== undefined && readOnlyReason(segment) !== undefined,
    );
  if (unavailable.length > 0) {
    const names = unavailable
      .map((segment) => {
        const reason =
          segment.status === "voided" ? "已作废" : "未开启人员管理";
        return `「${segment.name}」${reason}`;
      })
      .join("、");
    fail(`以下环节当前不可选择：${names}，整次同步未生效`);
  }

  const membershipBySegmentId = new Map(
    input.memberships.map((row) => [row.segmentId, row]),
  );
  const missingMembershipSegments = input.memberships.filter(
    (membership) => !segmentById.has(membership.segmentId),
  );
  if (missingMembershipSegments.length > 0) {
    fail("既有环节人员关系已失效，请刷新后重试");
  }

  const add = desiredSegmentIds
    .filter((segmentId) => !membershipBySegmentId.has(segmentId))
    .map(
      (segmentId) =>
        segmentById.get(segmentId) ?? fail("环节范围读取失败，请刷新后重试"),
    );

  const existing = desiredSegmentIds.flatMap((segmentId) => {
    const membership = membershipBySegmentId.get(segmentId);
    const segment = segmentById.get(segmentId);
    return membership && segment
      ? [
          {
            segmentMemberId: membership.id,
            segmentId,
            segmentName: segment.name,
            organizationId: membership.organizationId,
          },
        ]
      : [];
  });

  const remove: ActivityMemberSegmentSyncPlan["remove"] = [];
  const readOnlyRetained: ReadOnlySegmentMembership[] = [];
  const desiredSet = new Set(desiredSegmentIds);
  for (const membership of input.memberships) {
    const segment =
      segmentById.get(membership.segmentId) ??
      fail("环节范围读取失败，请刷新后重试");
    const reason = readOnlyReason(segment);
    if (reason) {
      readOnlyRetained.push({
        segmentMemberId: membership.id,
        segmentId: membership.segmentId,
        segmentName: segment.name,
        reason,
      });
    } else if (!desiredSet.has(membership.segmentId)) {
      remove.push({
        segmentMemberId: membership.id,
        segmentId: membership.segmentId,
        segmentName: segment.name,
        organizationId: membership.organizationId,
      });
    }
  }

  const segmentOrder = new Map(
    [...input.segments]
      .sort(byAgendaOrder)
      .map((segment, index) => [segment.id, index]),
  );
  const bySegmentOrder = (
    left: { segmentId: number },
    right: { segmentId: number },
  ) =>
    (segmentOrder.get(left.segmentId) ?? Number.MAX_SAFE_INTEGER) -
    (segmentOrder.get(right.segmentId) ?? Number.MAX_SAFE_INTEGER);

  return {
    desiredSegmentIds,
    add,
    existing,
    remove: remove.sort(bySegmentOrder),
    readOnlyRetained: readOnlyRetained.sort(bySegmentOrder),
  };
}

export type ActivityMemberSegmentSyncBlocker = {
  segmentMemberId: number;
  segmentId: number;
  segmentName: string;
  seats: Array<{
    assignmentId: number;
    seatLabel: string;
  }>;
  organizationSeats: Array<{
    assignmentId: number;
    organizationId: number;
    seatLabel: string;
  }>;
  trips: Array<{
    tripId: number;
    serviceNumber: string | null;
    departureTime: Date;
    departureLocation: string;
    destination: string;
  }>;
};

export type ActivityMemberSegmentSyncResult =
  | {
      applied: false;
      blocked: ActivityMemberSegmentSyncBlocker[];
      readOnlyRetained: ReadOnlySegmentMembership[];
    }
  | {
      applied: true;
      added: number;
      existing: number;
      removed: number;
      desiredSegmentIds: number[];
      readOnlyRetained: ReadOnlySegmentMembership[];
    };

const loadRemovalBlockers = async (
  tx: Tx,
  activityMemberId: number,
  plan: ActivityMemberSegmentSyncPlan,
): Promise<ActivityMemberSegmentSyncBlocker[]> => {
  if (plan.remove.length === 0) return [];

  const removingMemberIds = plan.remove.map((row) => row.segmentMemberId);
  const removingSegmentIds = new Set(plan.remove.map((row) => row.segmentId));
  const personAssignments = await tx
    .select({
      id: seatAssignment.id,
      segmentMemberId: seatAssignment.segmentMemberId,
      segmentSeatId: seatAssignment.segmentSeatId,
    })
    .from(seatAssignment)
    .where(
      and(
        eq(seatAssignment.occupantType, "person"),
        inArray(seatAssignment.segmentMemberId, removingMemberIds),
        isNull(seatAssignment.revokedAt),
      ),
    );

  const organizationAssignments = await listOrganizationSeatsLeavingScope(
    tx,
    removingMemberIds,
  );
  const organizationScopeKey = (segmentId: number, organizationId: number) =>
    `${segmentId}:${organizationId}`;

  const seatIds = [
    ...new Set(personAssignments.map((row) => row.segmentSeatId)),
  ];
  const seats =
    seatIds.length === 0
      ? []
      : await tx
          .select({ id: segmentSeat.id, label: segmentSeat.label })
          .from(segmentSeat)
          .where(inArray(segmentSeat.id, seatIds));
  const seatLabelById = new Map(seats.map((row) => [row.id, row.label]));

  const trips = await tx
    .select({
      id: memberTrip.id,
      segmentId: memberTrip.segmentId,
      serviceNumber: memberTrip.serviceNumber,
      departureTime: memberTrip.departureTime,
      departureLocation: memberTrip.departureLocation,
      destination: memberTrip.destination,
    })
    .from(memberTrip)
    .where(
      and(
        eq(memberTrip.activityMemberId, activityMemberId),
        inArray(memberTrip.segmentId, [...removingSegmentIds]),
      ),
    );

  const blockerByMembershipId = new Map<
    number,
    ActivityMemberSegmentSyncBlocker
  >(
    plan.remove.map((row) => [
      row.segmentMemberId,
      {
        segmentMemberId: row.segmentMemberId,
        segmentId: row.segmentId,
        segmentName: row.segmentName,
        seats: [],
        organizationSeats: [],
        trips: [],
      } satisfies ActivityMemberSegmentSyncBlocker,
    ]),
  );
  const membershipBySegmentId = new Map(
    plan.remove.map((row) => [row.segmentId, row.segmentMemberId]),
  );
  const membershipByOrganizationScope = new Map(
    plan.remove.flatMap((row) =>
      row.organizationId === null
        ? []
        : [
            [
              organizationScopeKey(row.segmentId, row.organizationId),
              row.segmentMemberId,
            ] as const,
          ],
    ),
  );

  for (const assignment of personAssignments) {
    if (assignment.segmentMemberId === null) continue;
    const blocker = blockerByMembershipId.get(assignment.segmentMemberId);
    if (!blocker) continue;
    blocker.seats.push({
      assignmentId: assignment.id,
      seatLabel:
        seatLabelById.get(assignment.segmentSeatId) ??
        `座位 #${assignment.segmentSeatId}`,
    });
  }

  for (const assignment of organizationAssignments) {
    const membershipId = membershipByOrganizationScope.get(
      organizationScopeKey(assignment.segmentId, assignment.organizationId),
    );
    const blocker = membershipId
      ? blockerByMembershipId.get(membershipId)
      : undefined;
    if (!blocker) continue;
    blocker.organizationSeats.push({
      assignmentId: assignment.id,
      organizationId: assignment.organizationId,
      seatLabel: assignment.seatLabel,
    });
  }

  for (const trip of trips) {
    if (trip.segmentId === null || !removingSegmentIds.has(trip.segmentId)) {
      continue;
    }
    const membershipId = membershipBySegmentId.get(trip.segmentId);
    const blocker = membershipId
      ? blockerByMembershipId.get(membershipId)
      : undefined;
    if (!blocker) continue;
    blocker.trips.push({
      tripId: trip.id,
      serviceNumber: trip.serviceNumber,
      departureTime: trip.departureTime,
      departureLocation: trip.departureLocation,
      destination: trip.destination,
    });
  }

  return [...blockerByMembershipId.values()].filter(
    (blocker) =>
      blocker.seats.length > 0 ||
      blocker.organizationSeats.length > 0 ||
      blocker.trips.length > 0,
  );
};

/**
 * 原子同步一名活动人员的可编辑环节集合。
 *
 * 调用方必须传事务句柄。所有范围校验、引用检查、新增和删除都在同一个事务里；
 * 返回 `applied:false` 代表正常的引用阻断结果，函数在该分支不会执行任何写入。
 */
export async function syncActivityMemberSegments(
  tx: Tx,
  input: {
    activityMemberId: number;
    segmentIds: readonly number[];
    userId: string;
  },
): Promise<ActivityMemberSegmentSyncResult> {
  const desiredSegmentIds = [...new Set(input.segmentIds)];
  const [relation] = await tx
    .select({
      id: activityMember.id,
      activityId: activityMember.activityId,
      memberId: activityMember.memberId,
      organizationId: activityMember.organizationId,
    })
    .from(activityMember)
    .where(eq(activityMember.id, input.activityMemberId))
    .for("update");
  if (!relation) fail("活动人员关系不存在，请刷新后重试");

  const memberships = await tx
    .select({
      id: segmentMember.id,
      segmentId: segmentMember.segmentId,
      organizationId: segmentMember.organizationId,
    })
    .from(segmentMember)
    .where(eq(segmentMember.activityMemberId, input.activityMemberId))
    .orderBy(asc(segmentMember.id))
    .for("update");

  const relevantSegmentIds = [
    ...new Set([
      ...desiredSegmentIds,
      ...memberships.map((row) => row.segmentId),
    ]),
  ];
  const segments =
    relevantSegmentIds.length === 0
      ? []
      : await tx
          .select({
            id: activitySegment.id,
            activityId: activitySegment.activityId,
            name: activitySegment.name,
            status: activitySegment.status,
            memberEnabled: activitySegment.memberEnabled,
            startTime: activitySegment.startTime,
          })
          .from(activitySegment)
          .where(inArray(activitySegment.id, relevantSegmentIds))
          .orderBy(asc(activitySegment.startTime), asc(activitySegment.id))
          .for("update");

  const plan = planActivityMemberSegmentSync({
    activityId: relation.activityId,
    desiredSegmentIds,
    segments,
    memberships,
  });
  const blocked = await loadRemovalBlockers(tx, input.activityMemberId, plan);
  if (blocked.length > 0) {
    return {
      applied: false,
      blocked,
      readOnlyRetained: plan.readOnlyRetained,
    };
  }

  // 这些行已经撤销，不再是有效排位；清掉它们仅用于释放 segment_member 外键，
  // 不会静默解除仍生效的座位。有效行已在上面的 blockers 分支整批挡住。
  const removingMemberIds = plan.remove.map((row) => row.segmentMemberId);
  if (removingMemberIds.length > 0) {
    await tx
      .delete(seatAssignment)
      .where(
        and(
          eq(seatAssignment.occupantType, "person"),
          inArray(seatAssignment.segmentMemberId, removingMemberIds),
          isNotNull(seatAssignment.revokedAt),
        ),
      );
  }

  const relationSnapshot: ActivityMemberSnapshot = relation;
  for (const segment of plan.add) {
    // segment_reference 表达“从活动人员的参与环节集合加入”；关系覆盖字段与
    // segmentRole 留空，由 schema 的 null=继承约定读取活动层默认值。
    await ensureSegmentMemberFromActivity(tx, {
      segmentId: segment.id,
      activityMember: relationSnapshot,
      originType: "segment_reference",
      userId: input.userId,
    });
  }

  if (removingMemberIds.length > 0) {
    const removed = await tx
      .delete(segmentMember)
      .where(inArray(segmentMember.id, removingMemberIds))
      .returning({ id: segmentMember.id });
    if (removed.length !== removingMemberIds.length) {
      fail("环节人员关系发生并发变化，整次同步未生效");
    }
  }

  return {
    applied: true,
    added: plan.add.length,
    existing: plan.existing.length,
    removed: plan.remove.length,
    desiredSegmentIds: plan.desiredSegmentIds,
    readOnlyRetained: plan.readOnlyRetained,
  };
}
