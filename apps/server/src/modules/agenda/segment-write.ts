import { and, eq, gt, lt, ne } from "drizzle-orm";
import type { db } from "../../infra/db";
import {
  activitySegment,
  activitySegmentRevision,
  agendaLine,
  type SegmentRevisionAction,
  type SegmentSnapshot,
} from "./schema";

/**
 * 环节写入的公共原语：字段投影、修改记录、议程线加锁、时间重叠检查。
 *
 * 单独成文件而不是留在 routes.ts 里，是因为它们有两类调用方：routes.ts 的
 * 单接口（createSegment / updateSegment / setSegmentStatus）和 segment-config.ts
 * 的聚合保存。留在 routes.ts 里的话，聚合那边只能 import 一个 Hono 应用文件，
 * 或者把这几段再抄一遍——而"同一条规则两份实现"正是这个模块最不能出的问题
 * （时间重叠判断抄错一个符号，症状是某些环节能重叠保存，很难发现）。
 *
 * 这个文件**不含任何聚合保存的逻辑**，删掉环节配置页也不影响它。
 */

/** 事务句柄。drizzle 没导出这个类型，从 db.transaction 的回调参数上取。 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// 显式字段投影：表上加一列不会顺带改掉 API 契约，也不会把 createdBy 这种
// 内部字段发到浏览器。
export const segmentFields = {
  id: activitySegment.id,
  activityId: activitySegment.activityId,
  agendaLineId: activitySegment.agendaLineId,
  name: activitySegment.name,
  segmentType: activitySegment.segmentType,
  startTime: activitySegment.startTime,
  endTime: activitySegment.endTime,
  locationText: activitySegment.locationText,
  description: activitySegment.description,
  ownerName: activitySegment.ownerName,
  status: activitySegment.status,
  memberEnabled: activitySegment.memberEnabled,
  seatingEnabled: activitySegment.seatingEnabled,
  createdAt: activitySegment.createdAt,
  updatedAt: activitySegment.updatedAt,
};

export type SegmentRow = {
  [K in keyof typeof segmentFields]: unknown;
} & {
  activityId: number;
  agendaLineId: number;
  name: string;
  segmentType: SegmentSnapshot["segmentType"];
  startTime: Date;
  endTime: Date;
  locationText: string | null;
  description: string | null;
  ownerName: string | null;
  status: SegmentSnapshot["status"];
  memberEnabled: boolean;
  seatingEnabled: boolean;
};

export const toSnapshot = (row: SegmentRow): SegmentSnapshot => ({
  activityId: row.activityId,
  agendaLineId: row.agendaLineId,
  name: row.name,
  segmentType: row.segmentType,
  startTime: row.startTime.toISOString(),
  endTime: row.endTime.toISOString(),
  locationText: row.locationText,
  description: row.description,
  ownerName: row.ownerName,
  status: row.status,
  memberEnabled: row.memberEnabled,
  seatingEnabled: row.seatingEnabled,
});

/**
 * 每次写入都留一条全量快照。C-016：本期记录修改人、修改时间和历史版本，
 * 页面不体现、不支持回滚——所以这张表只写不读。必须和环节写入在同一个
 * 事务里，否则回滚时会留下一条描述着并不存在的状态的记录。
 *
 * 快照范围**只有环节自身的字段**，人员/需求/资源的改动不进去。这是有意的：
 * 那张表现在只写不读，为了一个没人查的历史去扩大它的范围，属于顺手加活。
 */
export const recordRevision = (
  tx: Tx,
  segmentId: number,
  action: SegmentRevisionAction,
  row: SegmentRow,
  userId: string,
) =>
  tx.insert(activitySegmentRevision).values({
    segmentId,
    action,
    snapshot: toSnapshot(row),
    changedBy: userId,
  });

/**
 * 拿到目标议程线并**锁住它**，主线不存在时顺带建出来。
 *
 * 行锁不是可选项：重叠校验是"查一次没冲突就插入"，READ COMMITTED 下两个
 * 并发事务会各自查过、各自插入，于是同一条线上出现两个重叠环节，业务规则
 * 在并发下形同虚设。锁议程线这一行，等于把同一条线上的写入串行化，不同线
 * 之间互不阻塞——粒度正好。
 */
export async function lockLine(
  tx: Tx,
  activityId: number,
  agendaLineId: number | null,
  userId: string,
): Promise<{ ok: true; lineId: number } | { ok: false; message: string }> {
  if (agendaLineId !== null) {
    const [line] = await tx
      .select({ id: agendaLine.id, activityId: agendaLine.activityId })
      .from(agendaLine)
      .where(eq(agendaLine.id, agendaLineId))
      .for("update");

    if (!line) return { ok: false, message: "议程线不存在" };
    // 复合外键也会挡住这种写入，但那时报出来的是一条数据库约束错误；这里
    // 提前判一次是为了给出一句人能看懂的话。
    if (line.activityId !== activityId) {
      return { ok: false, message: "议程线不属于当前活动" };
    }
    return { ok: true, lineId: line.id };
  }

  const mainLineWhere = and(
    eq(agendaLine.activityId, activityId),
    eq(agendaLine.lineType, "main"),
  );

  const [existing] = await tx
    .select({ id: agendaLine.id })
    .from(agendaLine)
    .where(mainLineWhere)
    .for("update");

  if (existing) return { ok: true, lineId: existing.id };

  // 主线还不存在——懒创建。并发下两个请求会同时走到这里（上面的 FOR UPDATE
  // 没有行可锁），partial unique index 会让后到的那条 insert 落空，
  // onConflictDoNothing 把它变成"什么都不做"而不是抛错，然后重查拿到先到者
  // 建好的那条。READ COMMITTED 下这次重查一定看得到已提交的行。
  const [created] = await tx
    .insert(agendaLine)
    .values({
      activityId,
      lineType: "main",
      sortOrder: 0,
      createdBy: userId,
      updatedBy: userId,
    })
    .onConflictDoNothing()
    .returning({ id: agendaLine.id });

  if (created) return { ok: true, lineId: created.id };

  const [again] = await tx
    .select({ id: agendaLine.id })
    .from(agendaLine)
    .where(mainLineWhere);

  return again
    ? { ok: true, lineId: again.id }
    : { ok: false, message: "主线创建失败，请重试" };
}

/**
 * 同一议程线内的时间重叠检查。BR-DEV-031：不同议程线允许时间重叠，同一
 * 议程线时间重叠阻断环节保存。
 *
 * 半开区间 `[start, end)`：`existing.start < new.end AND existing.end > new.start`。
 * 零时长环节（start = end）对这个条件恒假，因此不会和任何环节冲突——这正是
 * 表上把 CHECK 放宽成 `<=` 之后需要的语义，不用额外分支。
 *
 * 只看 active：作废环节不占时间段。反过来说，把作废环节改回正常时必须
 * 重新跑一遍这个检查（见 setSegmentStatus）。
 */
export async function findOverlap(
  tx: Tx,
  lineId: number,
  startTime: Date,
  endTime: Date,
  excludeSegmentId?: number,
) {
  const [row] = await tx
    .select({ id: activitySegment.id, name: activitySegment.name })
    .from(activitySegment)
    .where(
      and(
        eq(activitySegment.agendaLineId, lineId),
        eq(activitySegment.status, "active"),
        excludeSegmentId ? ne(activitySegment.id, excludeSegmentId) : undefined,
        lt(activitySegment.startTime, endTime),
        gt(activitySegment.endTime, startTime),
      ),
    )
    .limit(1);

  return row;
}

export const overlapMessage = (name: string) =>
  `同一议程线上与「${name}」时间重叠，请调整时间，或把其中一个改到并行线`;
