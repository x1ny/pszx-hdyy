import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { db } from "../../infra/db";
import { activitySegment } from "../agenda/schema";
import { segmentMember } from "../member/schema";
import { seatAssignment, segmentSeat, segmentSeatingLog } from "./schema";

/**
 * seating 对外暴露的**级联出口**，专供 member 在移除人员时调用。
 *
 * ⚠️ 依赖方向在这个文件上是反的（member → seating）。这是
 * docs/场地排位底层设计.md §11 指定的分工——"移除人员时由 member 侧发起级联，
 * seating 提供'查引用 + 批量解绑'两个接口"。member 已经为 resource 模块的
 * `resourceMemberBinding` 用了同一套写法（见 routes.relation.ts 的导入），
 * 这里照抄那个先例，不新开一种模式。
 *
 * 之所以必须有这层：个人分配的 `seat_assignment.segmentMemberId →
 * segment_member.id` 外键**没有 cascade**，member 直接 `DELETE FROM
 * segment_member` 会撞约束报 500。团体占位没有挂到某个成员；只有移除的是其
 * 团体在该环节的最后一人时，才应因范围消失而解除该团体占位。这不是假想——
 * 评审时在回滚事务里复现过（docs/场地排位交互评审.md §3.1）。
 *
 * 单独一个文件而不是塞进 routes.ts：routes.ts 是 HTTP 层，这几个函数是**给别的
 * 模块在同一个事务里调**的纯数据操作，混在一起会让"谁能调用它"变得不清楚。
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 未撤销的分配。跟 routes.ts 里同名常量含义一致。 */
const live = isNull(seatAssignment.revokedAt);

type OrganizationSeatImpact = {
  id: number;
  planId: number;
  segmentSeatId: number;
  segmentId: number;
  organizationId: number;
  segmentName: string;
  seatLabel: string;
};

type SegmentOrganizationSnapshot = {
  id: number;
  segmentId: number;
  organizationId: number | null;
};

const organizationScopeKey = (segmentId: number, organizationId: number) =>
  `${segmentId}:${organizationId}`;

/** 计算移除一批环节人员后，哪些「环节 × 团体」范围快照会归零。 */
export function findEmptiedOrganizationScopes(
  leavingMembers: readonly SegmentOrganizationSnapshot[],
  scopedMembers: readonly SegmentOrganizationSnapshot[],
): Set<string> {
  const leavingSet = new Set(leavingMembers.map((row) => row.id));
  const emptiedScopes = new Set<string>();

  for (const row of leavingMembers) {
    if (row.organizationId === null) continue;
    const stillInScope = scopedMembers.some(
      (candidate) =>
        candidate.segmentId === row.segmentId &&
        candidate.organizationId === row.organizationId &&
        !leavingSet.has(candidate.id),
    );
    if (!stillInScope) {
      emptiedScopes.add(
        organizationScopeKey(row.segmentId, row.organizationId),
      );
    }
  }

  return emptiedScopes;
}

/**
 * 这个活动人员在各环节占了哪些座位。给 member 的 `/impact` 用——
 * 移除前的清单必须把座位列出来，不能只报个数字：运营看到"3 个座位"和看到
 * "开幕式 A3、主论坛 B7"是两种决策质量。
 */
export async function listSeatsByActivityMember(
  conn: Pick<typeof db, "select">,
  activityMemberId: number,
) {
  return conn
    .select({
      seatLabel: segmentSeat.label,
      segmentName: activitySegment.name,
    })
    .from(seatAssignment)
    .innerJoin(
      segmentMember,
      eq(segmentMember.id, seatAssignment.segmentMemberId),
    )
    .innerJoin(segmentSeat, eq(segmentSeat.id, seatAssignment.segmentSeatId))
    .innerJoin(activitySegment, eq(activitySegment.id, segmentMember.segmentId))
    .where(
      and(
        eq(segmentMember.activityMemberId, activityMemberId),
        eq(seatAssignment.occupantType, "person"),
        live,
      ),
    )
    .orderBy(asc(activitySegment.startTime));
}

/** 同上，但只要个数——`remove` 的前置判断用它，不需要把清单拉回来。 */
export async function listSeatsBySegmentMember(
  conn: Pick<typeof db, "select">,
  segmentMemberId: number,
) {
  return conn
    .select({
      seatLabel: segmentSeat.label,
      segmentName: activitySegment.name,
    })
    .from(seatAssignment)
    .innerJoin(
      segmentMember,
      eq(segmentMember.id, seatAssignment.segmentMemberId),
    )
    .innerJoin(segmentSeat, eq(segmentSeat.id, seatAssignment.segmentSeatId))
    .innerJoin(activitySegment, eq(activitySegment.id, segmentMember.segmentId))
    .where(
      and(
        eq(seatAssignment.segmentMemberId, segmentMemberId),
        eq(seatAssignment.occupantType, "person"),
        live,
      ),
    )
    .orderBy(asc(activitySegment.startTime));
}

/**
 * 要离开的环节人员若是其团体在该环节的最后一人，那个团体就不再处于环节范围。
 * 找出因此必须解除的**生效中**团体占位；被撤销的历史分配无需再参与范围校验。
 */
export async function listOrganizationSeatsLeavingScope(
  conn: Pick<typeof db, "select">,
  segmentMemberIds: number[],
): Promise<OrganizationSeatImpact[]> {
  if (segmentMemberIds.length === 0) return [];

  const leavingIds = [...new Set(segmentMemberIds)];
  const leavingMembers = await conn
    .select({
      id: segmentMember.id,
      segmentId: segmentMember.segmentId,
      organizationId: segmentMember.organizationId,
    })
    .from(segmentMember)
    .where(
      and(
        inArray(segmentMember.id, leavingIds),
        isNotNull(segmentMember.organizationId),
      ),
    );
  if (leavingMembers.length === 0) return [];

  const segmentIds = [...new Set(leavingMembers.map((row) => row.segmentId))];
  const organizationIds = [
    ...new Set(
      leavingMembers.flatMap((row) =>
        row.organizationId === null ? [] : [row.organizationId],
      ),
    ),
  ];
  const scopedMembers = await conn
    .select({
      id: segmentMember.id,
      segmentId: segmentMember.segmentId,
      organizationId: segmentMember.organizationId,
    })
    .from(segmentMember)
    .where(
      and(
        inArray(segmentMember.segmentId, segmentIds),
        inArray(segmentMember.organizationId, organizationIds),
      ),
    );

  const emptiedScopes = findEmptiedOrganizationScopes(
    leavingMembers,
    scopedMembers,
  );
  if (emptiedScopes.size === 0) return [];

  const candidates = await conn
    .select({
      id: seatAssignment.id,
      planId: seatAssignment.planId,
      segmentSeatId: seatAssignment.segmentSeatId,
      segmentId: seatAssignment.segmentId,
      organizationId: seatAssignment.organizationId,
      segmentName: activitySegment.name,
      seatLabel: segmentSeat.label,
    })
    .from(seatAssignment)
    .innerJoin(segmentSeat, eq(segmentSeat.id, seatAssignment.segmentSeatId))
    .innerJoin(
      activitySegment,
      eq(activitySegment.id, seatAssignment.segmentId),
    )
    .where(
      and(
        eq(seatAssignment.occupantType, "organization"),
        live,
        inArray(seatAssignment.segmentId, segmentIds),
        inArray(seatAssignment.organizationId, organizationIds),
      ),
    );

  return candidates.filter(
    (row): row is OrganizationSeatImpact =>
      row.organizationId !== null &&
      emptiedScopes.has(
        organizationScopeKey(row.segmentId, row.organizationId),
      ),
  );
}

/**
 * 把这些环节人员身上的**个人**座位分配物理删除，并给每个受影响的方案留日志。
 *
 * 为什么是物理删除而不是软撤销（`revokedAt`）：外键约束的是"有没有行指向
 * `segment_member`"，跟 `revokedAt` 无关——软撤销之后那一行还在，
 * `DELETE FROM segment_member` 照样撞约束。人都要从活动里移除了，
 * `segment_member` 本身也是硬删的，分配行没有单独留存的意义。
 *
 * 已确认方案的历史不会因此丢失：confirm 那一刻写进 `segment_seating_log` 的
 * 完整快照（位置 + 分配 + 当时的编号）是独立的一份，不受这里影响——
 * 这正是当初把通知名单挂在确认快照上、而不是挂在分配行上的理由（§3.1、§7）。
 *
 * @returns 删掉的分配条数
 */
export async function releaseSeatsBySegmentMembers(
  tx: Tx,
  segmentMemberIds: number[],
  operatorId: string,
): Promise<number> {
  if (segmentMemberIds.length === 0) return 0;

  const rows = await tx
    .select({
      id: seatAssignment.id,
      planId: seatAssignment.planId,
      segmentSeatId: seatAssignment.segmentSeatId,
      segmentMemberId: seatAssignment.segmentMemberId,
    })
    .from(seatAssignment)
    .where(
      and(
        eq(seatAssignment.occupantType, "person"),
        inArray(seatAssignment.segmentMemberId, segmentMemberIds),
      ),
    );

  if (rows.length === 0) return 0;

  await tx.delete(seatAssignment).where(
    inArray(
      seatAssignment.id,
      rows.map((row) => row.id),
    ),
  );

  // 一个方案一条日志，不是一个座位一条——运营关心的是"这次移除动了哪几份排位"。
  const byPlan = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byPlan.get(row.planId) ?? [];
    list.push(row);
    byPlan.set(row.planId, list);
  }

  await tx.insert(segmentSeatingLog).values(
    [...byPlan].map(([planId, list]) => ({
      planId,
      action: "unassign" as const,
      operatorId,
      payload: {
        reason: "memberRemoved",
        seats: list.map((row) => ({
          seatId: row.segmentSeatId,
          occupantType: "person",
          segmentMemberId: row.segmentMemberId,
        })),
      },
    })),
  );

  return rows.length;
}

/**
 * 团体离开环节范围时软撤其生效占位，并按方案写明原因。它们不引用
 * segment_member，因此不能也不应走个人删除时的物理清理路径。
 */
export async function releaseOrganizationSeatsLeavingScope(
  tx: Tx,
  segmentMemberIds: number[],
  operatorId: string,
): Promise<number> {
  const rows = await listOrganizationSeatsLeavingScope(tx, segmentMemberIds);
  if (rows.length === 0) return 0;

  await tx
    .update(seatAssignment)
    .set({ revokedBy: operatorId, revokedAt: new Date() })
    .where(
      inArray(
        seatAssignment.id,
        rows.map((row) => row.id),
      ),
    );

  const byPlan = new Map<number, OrganizationSeatImpact[]>();
  for (const row of rows) {
    const list = byPlan.get(row.planId) ?? [];
    list.push(row);
    byPlan.set(row.planId, list);
  }
  await tx.insert(segmentSeatingLog).values(
    [...byPlan].map(([planId, list]) => ({
      planId,
      action: "unassign" as const,
      operatorId,
      payload: {
        reason: "organizationOutOfSegmentScope",
        seats: list.map((row) => ({
          seatId: row.segmentSeatId,
          occupantType: "organization",
          organizationId: row.organizationId,
        })),
      },
    })),
  );

  return rows.length;
}

/** 按活动人员解绑——先查出他名下的环节人员，再走上面那条。 */
export async function releaseSeatsByActivityMember(
  tx: Tx,
  activityMemberId: number,
  operatorId: string,
): Promise<number> {
  const members = await tx
    .select({ id: segmentMember.id })
    .from(segmentMember)
    .where(eq(segmentMember.activityMemberId, activityMemberId));

  return releaseSeatsBySegmentMembers(
    tx,
    members.map((row) => row.id),
    operatorId,
  );
}
