import type { db } from "../infra/db";

export type SeedDb = typeof db;

/** 种子文件之间唯一的运行时传递物。00-user.ts 负责把 userId 填上，
 *  后面的文件用它填 createdBy —— 按文件名顺序执行保证了这一点。 */
export type SeedContext = { userId: string };

export type SeedFn = (db: SeedDb, ctx: SeedContext) => Promise<void>;

/**
 * 演示数据的固定 ID。写死而不是让序列自增，是为了让 AGENTS.md 里能直接给出
 * 可导航的 URL（`/project/1`、`/project/1/activity/1`），也让任何一次报错都
 * 可复现。bootstrap.ts 在种子跑完后会把各表的 identity 序列推到 max(id)，
 * 所以之后从界面新增记录不会撞主键。
 */
export const DEMO = {
  projectId: 1,
  activityId: 1,
  mainLineId: 1,
  parallelLineId: 2,
  segmentIds: { opening: 1, forum: 2, negotiation: 3 },
  venueId: 1,
  activityVenueId: 1,
} as const;
