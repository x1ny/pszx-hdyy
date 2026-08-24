import { activitySegment, agendaLine } from "../modules/agenda/schema";
import { DEMO, type SeedFn } from "./context";

export const seed: SeedFn = async (db, { userId }) => {
  await db.insert(agendaLine).values([
    {
      id: DEMO.mainLineId,
      activityId: DEMO.activityId,
      lineType: "main",
      name: "主线",
      sortOrder: 0,
      createdBy: userId,
      updatedBy: userId,
    },
    {
      id: DEMO.parallelLineId,
      activityId: DEMO.activityId,
      lineType: "parallel",
      name: "平行分论坛",
      sortOrder: 1,
      createdBy: userId,
      updatedBy: userId,
    },
  ]);

  await db.insert(activitySegment).values([
    {
      id: DEMO.segmentIds.opening,
      activityId: DEMO.activityId,
      agendaLineId: DEMO.mainLineId,
      name: "开幕致辞",
      segmentType: "keynote",
      startTime: new Date("2026-09-10T09:00:00+08:00"),
      endTime: new Date("2026-09-10T09:40:00+08:00"),
      locationText: "A 馆主会场",
      ownerName: "王芳",
      memberEnabled: true,
      seatingEnabled: true,
      createdBy: userId,
      updatedBy: userId,
    },
    {
      id: DEMO.segmentIds.forum,
      activityId: DEMO.activityId,
      agendaLineId: DEMO.mainLineId,
      name: "主论坛：可持续时尚",
      segmentType: "forum",
      startTime: new Date("2026-09-10T10:00:00+08:00"),
      endTime: new Date("2026-09-10T12:00:00+08:00"),
      locationText: "A 馆主会场",
      ownerName: "王芳",
      memberEnabled: true,
      seatingEnabled: true,
      createdBy: userId,
      updatedBy: userId,
    },
    {
      // 刻意和主论坛时间重叠：议程页对「同一人员在两个并行环节」的冲突提示
      // 需要真实存在的重叠数据才测得出来（见 modules/member/conflicts.ts）。
      id: DEMO.segmentIds.negotiation,
      activityId: DEMO.activityId,
      agendaLineId: DEMO.parallelLineId,
      name: "分论坛：供应链数字化",
      segmentType: "negotiation",
      startTime: new Date("2026-09-10T10:30:00+08:00"),
      endTime: new Date("2026-09-10T12:30:00+08:00"),
      locationText: "A 馆 2 号厅",
      ownerName: "李强",
      memberEnabled: true,
      createdBy: userId,
      updatedBy: userId,
    },
  ]);
};
