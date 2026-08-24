import { activity, project } from "../modules/project/schema";
import { DEMO, type SeedFn } from "./context";

export const seed: SeedFn = async (db, { userId }) => {
  await db.insert(project).values({
    id: DEMO.projectId,
    name: "2026 秋季时尚产业周",
    location: "杭州市萧山区",
    startTime: new Date("2026-09-10T09:00:00+08:00"),
    endTime: new Date("2026-09-14T18:00:00+08:00"),
    totalBudget: "1200000.00",
    hostOrg: "杭州市时尚产业促进会",
    organizerOrg: "萧山区商务局",
    supportOrg: "浙江省服装行业协会",
    guidingOrg: "杭州市商务局",
    description:
      "开发用演示项目：下挂一个活动、两条议程线、三个环节和一批人员。",
    publishStatus: "published",
    createdBy: userId,
    updatedBy: userId,
  });

  await db.insert(activity).values([
    {
      id: DEMO.activityId,
      projectId: DEMO.projectId,
      activityType: "standalone",
      name: "开幕式暨主论坛",
      location: "杭州国际博览中心 A 馆",
      startTime: new Date("2026-09-10T09:00:00+08:00"),
      endTime: new Date("2026-09-10T18:00:00+08:00"),
      totalBudget: "480000.00",
      hostOrg: "杭州市时尚产业促进会",
      organizerOrg: "萧山区商务局",
      description: "演示活动：议程、人员、场地、排位都挂在这个活动下。",
      publishStatus: "published",
      displayEnabled: true,
      registrationEnabled: true,
      createdBy: userId,
      updatedBy: userId,
    },
    {
      id: DEMO.activityId + 1,
      projectId: DEMO.projectId,
      activityType: "affiliated",
      name: "供应链对接洽谈会",
      location: "杭州国际博览中心 B 馆",
      startTime: new Date("2026-09-12T13:30:00+08:00"),
      endTime: new Date("2026-09-12T17:30:00+08:00"),
      totalBudget: "160000.00",
      description: "第二个活动，用来验证活动列表和项目下的活动数统计。",
      publishStatus: "draft",
      createdBy: userId,
      updatedBy: userId,
    },
  ]);
};
