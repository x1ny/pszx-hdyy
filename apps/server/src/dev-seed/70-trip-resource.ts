import {
  activityResource,
  resourceMemberBinding,
} from "../modules/resource/schema";
import { memberTrip } from "../modules/trip/schema";
import type { SeedFn } from "./context";
import { DEMO } from "./context";

/**
 * 到离行程和用车。
 *
 * 加这个文件的直接原因：**h5 行程页把交通渲染成三种卡，而在这之前种子里一条
 * 交通数据都没有** —— 那三种卡加上行程里的「待定安排」分组，谁都没在页面上
 * 见过。管理端的行程页和资源页同样是空的。
 *
 * 所以下面这几条是照着「每一种渲染分支各来一条」凑的，不是随手填的样例：
 *
 * | 数据 | 覆盖的分支 |
 * | --- | --- |
 * | 王芳的航班（活动前一天） | 票务卡 + h5 的「出发日」日卡（只有交通没有议程） |
 * | 王芳的高铁（活动后一天） | 票务卡 + 「返程日」 |
 * | 王芳的接驳车（有起止时间） | 混排进当天时间轴，预计车程 50 分钟，司机电话可拨 |
 * | 王芳的送站车（**没有**发车时间） | 行程里的「待定安排」，不显示预计车程 |
 * | 刘洋的自驾 | 通用行程卡（没有票务字段那一版） |
 *
 * 刘洋那条同时是重号演示的另一半：他和陈静共用 13810000003（见 50-member.ts），
 * 拿那个号进 h5 看到的是刘洋的自驾，不是陈静的。
 *
 * 活动本身是 2026-09-10 09:00–18:00（+08:00），前后两天正好落在活动区间外。
 */
export const seed: SeedFn = async (db, { userId }) => {
  const audit = { createdBy: userId, updatedBy: userId };
  const scope = {
    projectId: DEMO.projectId,
    activityId: DEMO.activityId,
  };

  await db.insert(memberTrip).values([
    {
      ...scope,
      activityMemberId: 1,
      memberId: 1,
      transportMode: "flight",
      serviceNumber: "MU5138",
      departureTime: new Date("2026-09-09T19:30:00+08:00"),
      arrivalTime: new Date("2026-09-09T22:05:00+08:00"),
      departureLocation: "北京首都 T2",
      destination: "杭州萧山国际机场",
      ...audit,
    },
    {
      ...scope,
      activityMemberId: 1,
      memberId: 1,
      transportMode: "train",
      serviceNumber: "G7304",
      departureTime: new Date("2026-09-11T14:10:00+08:00"),
      arrivalTime: new Date("2026-09-11T15:39:00+08:00"),
      departureLocation: "杭州东站",
      destination: "上海虹桥站",
      ...audit,
    },
    {
      ...scope,
      activityMemberId: 4,
      memberId: 4,
      // 驾车没有车次/航班号，走的是另一套版式 —— serviceNumber 留空正是要
      // 验证「没有票务字段」那条分支。
      transportMode: "drive",
      serviceNumber: null,
      departureTime: new Date("2026-09-10T06:40:00+08:00"),
      arrivalTime: new Date("2026-09-10T08:30:00+08:00"),
      departureLocation: "宁波市鄞州区",
      destination: "杭州国际博览中心 A 馆",
      ...audit,
    },
  ]);

  await db.insert(activityResource).values([
    {
      id: 1,
      activityId: DEMO.activityId,
      resourceType: "transport",
      transportScene: "pickup",
      name: "机场接驳专车",
      quantity: 1,
      startTime: new Date("2026-09-09T22:30:00+08:00"),
      endTime: new Date("2026-09-09T23:20:00+08:00"),
      location: "萧山机场 T4 到达层 3 号门",
      vehicleInfo: "浙A·D8866",
      driverName: "王师傅",
      driverPhone: "13805710088",
      ownerName: "李强",
      status: "active",
      ...audit,
    },
    {
      id: 2,
      activityId: DEMO.activityId,
      resourceType: "transport",
      transportScene: "dropoff",
      name: "闭幕送站专车",
      quantity: 1,
      // 时间可空：验证同一行程列表中的「待定安排」，不猜日期，也不显示预计车程。
      startTime: null,
      endTime: null,
      location: "A 馆东门 贵宾通道",
      vehicleInfo: "浙A·F2218",
      driverName: "李师傅",
      driverPhone: "13805710099",
      ownerName: "李强",
      remark: "闭幕式散场后发车，具体时间以现场通知为准",
      status: "active",
      ...audit,
    },
  ]);

  await db.insert(resourceMemberBinding).values([
    {
      activityId: DEMO.activityId,
      resourceId: 1,
      activityMemberId: 1,
      memberId: 1,
      createdBy: userId,
    },
    {
      activityId: DEMO.activityId,
      resourceId: 2,
      activityMemberId: 1,
      memberId: 1,
      createdBy: userId,
    },
  ]);
};
