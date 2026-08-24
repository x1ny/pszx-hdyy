import {
  activityVenue,
  activityVenueZone,
  DEFAULT_PURPOSE_BY_KIND,
  venue,
  venueSeat,
  venueZone,
} from "../modules/venue/schema";
import { DEMO, type SeedFn } from "./context";

// 只灌结构化的三层（场地 / 区域 / 座位），**不灌 venue_layout 的画布 JSON** ——
// 那份数据的形状由前端画布决定，手写一份等于把画布的内部格式复制进种子，
// 画布一改种子就悄悄失效。没有 layout 行时场地详情页走的是「还没画」这条正常
// 分支，需要画布数据的调试自己在页面上画一个即可。
export const seed: SeedFn = async (db, { userId }) => {
  await db.insert(venue).values({
    id: DEMO.venueId,
    name: "杭州国际博览中心 A 馆",
    address: "杭州市萧山区奔竞大道 353 号",
    description: "开发用演示场地：两个区域、十个座位。",
    status: "enabled",
    createdBy: userId,
    updatedBy: userId,
  });

  await db.insert(venueZone).values([
    {
      id: 1,
      venueId: DEMO.venueId,
      externalId: "zone-main",
      name: "主会场坐席区",
      kind: "seating",
      ordinal: 0,
    },
    {
      id: 2,
      venueId: DEMO.venueId,
      externalId: "zone-checkin",
      name: "签到区",
      kind: "checkin",
      ordinal: 1,
    },
  ]);

  await db.insert(venueSeat).values(
    Array.from({ length: 10 }, (_, index) => ({
      venueId: DEMO.venueId,
      zoneId: 1,
      externalId: `seat-a-${index + 1}`,
      label: `A 排 ${index + 1} 号`,
      kind: "seat" as const,
      rank: index < 2 ? ("vip" as const) : ("normal" as const),
      ordinal: index,
    })),
  );

  // 活动场地空间是从场地库拷贝下来的一份副本（依赖方向见 index.ts 的注释）。
  await db.insert(activityVenue).values({
    id: DEMO.activityVenueId,
    activityId: DEMO.activityId,
    sourceVenueId: DEMO.venueId,
    name: "杭州国际博览中心 A 馆",
    address: "杭州市萧山区奔竞大道 353 号",
    status: "active",
    ordinal: 0,
    createdBy: userId,
    updatedBy: userId,
  });

  await db.insert(activityVenueZone).values([
    {
      id: 1,
      activityVenueId: DEMO.activityVenueId,
      activityId: DEMO.activityId,
      sourceZoneId: 1,
      externalId: "zone-main",
      name: "主会场坐席区",
      kind: "seating",
      purpose: DEFAULT_PURPOSE_BY_KIND.seating,
      capacity: 10,
      status: "active",
      ordinal: 0,
    },
    {
      id: 2,
      activityVenueId: DEMO.activityVenueId,
      activityId: DEMO.activityId,
      sourceZoneId: 2,
      externalId: "zone-checkin",
      name: "签到区",
      kind: "checkin",
      purpose: DEFAULT_PURPOSE_BY_KIND.checkin,
      capacity: 0,
      status: "active",
      ordinal: 1,
    },
  ]);
};
