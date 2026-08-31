import { and, eq } from "drizzle-orm";
import { segmentMember } from "../modules/member/schema";
import {
  seatAssignment,
  segmentSeat,
  segmentSeatingLayout,
  segmentSeatingPlan,
} from "../modules/seating/schema";
import { DEMO, type SeedFn } from "./context";

const SEAT_COLUMNS = 5;
const SEAT_COUNT = 10;

const seats = Array.from({ length: SEAT_COUNT }, (_, index) => {
  const row = Math.floor(index / SEAT_COLUMNS);
  const column = index % SEAT_COLUMNS;
  const rowLabel = row === 0 ? "A" : "B";

  return {
    id: index + 1,
    externalId: `demo-forum-seat-${index + 1}`,
    zoneExternalId: "zone-main",
    label: `${rowLabel}${column + 1}`,
    kind: "seat" as const,
    rank: index < 2 ? ("vip" as const) : ("normal" as const),
    ordinal: index,
    x: 100 + column * 140,
    y: 100 + row * 120,
  };
});

/**
 * 专门给开发环境排位联调用的最小画布 fixture。
 *
 * 场地种子仍然不伪造 venue_layout：场地编辑器需要覆盖「还没画平面图」的正常
 * 降级分支。但排位页若没有一份真实的方案画布，就无法调分配、解绑、换座和团体
 * 占位。这里因此只固定一份 `svg-canvas-v1` 方案文档，并同时写入核心座位行；
 * 两份数据来自上面的同一个 seats 数组，避免画布与关系表各写一套后静默漂移。
 */
const layoutData = {
  schemaVersion: 1,
  world: { width: 760, height: 320 },
  zones: [
    {
      externalId: "zone-main",
      name: "主会场坐席区",
      kind: "seating",
      ordinal: 0,
      fill: "#DBEAFE",
      stroke: "#60A5FA",
      shape: {
        type: "rect",
        x: 0,
        y: 0,
        width: 760,
        height: 320,
      },
    },
  ],
  seats: seats.map(({ id: _id, ...seat }) => seat),
};

export const seed: SeedFn = async (db, { userId }) => {
  const [assignedMember] = await db
    .select({ id: segmentMember.id })
    .from(segmentMember)
    .where(
      and(
        eq(segmentMember.segmentId, DEMO.segmentIds.forum),
        eq(segmentMember.memberId, 1),
      ),
    )
    .limit(1);

  if (!assignedMember) {
    throw new Error("主论坛缺少王芳的环节人员关系，无法创建排位演示数据");
  }

  await db.insert(segmentSeatingPlan).values({
    id: DEMO.seatingPlanId,
    segmentId: DEMO.segmentIds.forum,
    activityId: DEMO.activityId,
    activityVenueZoneId: DEMO.mainActivityVenueZoneId,
    status: "pending",
    version: 0,
    savedBy: userId,
    savedAt: new Date("2026-08-31T10:00:00+08:00"),
  });

  await db.insert(segmentSeatingLayout).values({
    planId: DEMO.seatingPlanId,
    rendererKind: "svg-canvas-v1",
    rendererVersion: 1,
    data: layoutData,
    updatedBy: userId,
  });

  await db.insert(segmentSeat).values(
    seats.map((seat) => ({
      id: seat.id,
      planId: DEMO.seatingPlanId,
      externalId: seat.externalId,
      sourceExternalId: seat.externalId,
      label: seat.label,
      kind: seat.kind,
      rank: seat.rank,
      enabled: true,
      ordinal: seat.ordinal,
    })),
  );

  // 预留八个空位供真实操作；两条初始占用分别覆盖个人和团体两种展示/解绑路径。
  await db.insert(seatAssignment).values([
    {
      id: 1,
      planId: DEMO.seatingPlanId,
      segmentId: DEMO.segmentIds.forum,
      segmentSeatId: seats[0]?.id ?? 1,
      occupantType: "person",
      segmentMemberId: assignedMember.id,
      assignedBy: userId,
    },
    {
      id: 2,
      planId: DEMO.seatingPlanId,
      segmentId: DEMO.segmentIds.forum,
      segmentSeatId: seats[1]?.id ?? 2,
      occupantType: "organization",
      organizationId: DEMO.organizationIds.textileChamber,
      assignedBy: userId,
    },
  ]);
};
