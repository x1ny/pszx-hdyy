import { and, eq } from "drizzle-orm";
import { segmentMember } from "../modules/member/schema";
import {
  seatAssignment,
  segmentSeat,
  segmentSeatingLayout,
  segmentSeatingPlan,
} from "../modules/seating/schema";
import { DEMO, type SeedFn } from "./context";

const SEAT_COLUMNS = 10;
const SEAT_COUNT = 50;
const SEAT_X_GAP = 140;
const SEAT_Y_GAP = 120;
const CANVAS_PADDING = 100;
const SEAT_ROWS = Math.ceil(SEAT_COUNT / SEAT_COLUMNS);

const seats = Array.from({ length: SEAT_COUNT }, (_, index) => {
  const row = Math.floor(index / SEAT_COLUMNS);
  const column = index % SEAT_COLUMNS;
  const rowLabel = String.fromCharCode("A".charCodeAt(0) + row);

  return {
    id: index + 1,
    externalId: `demo-forum-seat-${index + 1}`,
    zoneExternalId: "zone-main",
    label: `${rowLabel}${column + 1}`,
    kind: "seat" as const,
    rank: index < 2 ? ("vip" as const) : ("normal" as const),
    ordinal: index,
    x: CANVAS_PADDING + column * SEAT_X_GAP,
    y: CANVAS_PADDING + row * SEAT_Y_GAP,
  };
});

/**
 * 专门给开发环境排位联调用的批量画布 fixture。
 *
 * 场地种子仍然不伪造 venue_layout：场地编辑器需要覆盖「还没画平面图」的正常
 * 降级分支。但排位页若没有一份真实的方案画布，就无法调分配、解绑、换座和团体
 * 占位。这里因此只固定一份 `svg-canvas-v1` 方案文档，并同时写入核心座位行；
 * 两份数据来自上面的同一个 seats 数组，避免画布与关系表各写一套后静默漂移。
 */
const layoutData = {
  schemaVersion: 1,
  world: {
    width: CANVAS_PADDING * 2 + (SEAT_COLUMNS - 1) * SEAT_X_GAP,
    height: CANVAS_PADDING * 2 + (SEAT_ROWS - 1) * SEAT_Y_GAP,
  },
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
        width: CANVAS_PADDING * 2 + (SEAT_COLUMNS - 1) * SEAT_X_GAP,
        height: CANVAS_PADDING * 2 + (SEAT_ROWS - 1) * SEAT_Y_GAP,
      },
    },
  ],
  seats: seats.map(({ id: _id, ...seat }) => seat),
  // 关系顺序和几何坐标分别保存：H5 团体范围按这份明确的排顺序合并，绝不从
  // A/B 标签或 y 坐标猜「下一排」；`aisleEvery` 只是几何留白，不切断座号范围。
  rows: Array.from({ length: SEAT_ROWS }, (_, row) => ({
    externalId: `demo-forum-row-${row + 1}`,
    zoneExternalId: "zone-main",
    name: `${String.fromCharCode("A".charCodeAt(0) + row)}排`,
    seatIds: seats
      .slice(row * SEAT_COLUMNS, (row + 1) * SEAT_COLUMNS)
      .map((seat) => seat.externalId),
    shape: "line",
    x: CANVAS_PADDING,
    y: CANVAS_PADDING + row * SEAT_Y_GAP,
    angle: 0,
    spacing: SEAT_X_GAP,
    aisleEvery: 5,
  })),
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
    // 已确认，不是 pending —— **h5 的行程页只显示 confirmed 方案的座位**
    // （modules/h5/routes.ts 里那段口径）。留 pending 的话本地一打开 h5 就是
    // 「座位待安排」，那块根本调不了。管理端的排位流程不受影响：确认态同样
    // 可以改、可以驳回，只是多点一步。
    status: "confirmed",
    version: 0,
    savedBy: userId,
    savedAt: new Date("2026-08-31T10:00:00+08:00"),
    confirmedBy: userId,
    confirmedAt: new Date("2026-08-31T10:05:00+08:00"),
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

  // 王芳预占两座；纺织商会保留单席团体占位；时尚产业促进会占 A4–A6，供没有
  // 个人排座的成员在 H5 验收「我的团体座位」和过道不断开范围的路径。
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
    {
      id: 3,
      planId: DEMO.seatingPlanId,
      segmentId: DEMO.segmentIds.forum,
      segmentSeatId: seats[2]?.id ?? 3,
      occupantType: "person",
      segmentMemberId: assignedMember.id,
      assignedBy: userId,
    },
    ...[3, 4, 5].map((index) => ({
      id: index + 1,
      planId: DEMO.seatingPlanId,
      segmentId: DEMO.segmentIds.forum,
      segmentSeatId: seats[index]?.id ?? index + 1,
      occupantType: "organization" as const,
      organizationId: DEMO.organizationIds.fashionAssociation,
      assignedBy: userId,
    })),
  ]);
};
