import { and, asc, count, eq, gt, lt, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import {
  activitySegment,
  activitySegmentRevision,
  agendaLine,
  type SegmentRevisionAction,
  type SegmentSnapshot,
} from "./schema";
import {
  AgendaLineIdInput,
  CreateAgendaLineInput,
  CreateSegmentInput,
  ListAgendaInput,
  SetSegmentStatusInput,
  UpdateAgendaLineInput,
  UpdateSegmentInput,
} from "./validation";

/** 事务句柄。drizzle 没导出这个类型，从 db.transaction 的回调参数上取。 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// 显式字段投影：表上加一列不会顺带改掉 API 契约，也不会把 createdBy 这种
// 内部字段发到浏览器。
const lineFields = {
  id: agendaLine.id,
  activityId: agendaLine.activityId,
  lineType: agendaLine.lineType,
  name: agendaLine.name,
  sortOrder: agendaLine.sortOrder,
};

const segmentFields = {
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

type SegmentRow = {
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

/**
 * 事务回调的返回形状。带一个 `kind` 判别字段而不是靠可选属性区分——不然
 * 三个分支合并出来的类型里 `row` 是可选的，`c.json(ok(result.row))` 推出来
 * 的 data 就带上了 `| undefined`，这个 undefined 会一路漂到前端。
 */
type TxResult<T> =
  | { kind: "ok"; row: T }
  | { kind: "notFound" }
  | { kind: "invalid"; message: string };

const segmentNotFound = () =>
  err({ code: "NOT_FOUND" as const, message: "环节不存在" });

const lineNotFound = () =>
  err({ code: "NOT_FOUND" as const, message: "议程线不存在" });

const invalid = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

const toSnapshot = (row: SegmentRow): SegmentSnapshot => ({
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
 */
const recordRevision = (
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
async function lockLine(
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
async function findOverlap(
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
        excludeSegmentId
          ? ne(activitySegment.id, excludeSegmentId)
          : undefined,
        lt(activitySegment.startTime, endTime),
        gt(activitySegment.endTime, startTime),
      ),
    )
    .limit(1);

  return row;
}

const overlapMessage = (name: string) =>
  `同一议程线上与「${name}」时间重叠，请调整时间，或把其中一个改到并行线`;

export const agendaRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  // ------------------------------------------------------------------ 查询 --

  .post("/api/listAgenda", jsonBody(ListAgendaInput), async (c) => {
    const { activityId } = c.req.valid("json");

    const [lines, segments] = await Promise.all([
      db
        .select(lineFields)
        .from(agendaLine)
        .where(eq(agendaLine.activityId, activityId))
        // 主线永远第一层，其余按线的排序值。不写成 asc(lineType) 碰运气
        // （"main" < "parallel" 只是字母序恰好对），枚举改个名就崩了。
        .orderBy(
          sql`case when ${agendaLine.lineType} = 'main' then 0 else 1 end`,
          asc(agendaLine.sortOrder),
          asc(agendaLine.id),
        ),
      db
        .select(segmentFields)
        .from(activitySegment)
        .where(eq(activitySegment.activityId, activityId))
        // id 兜底：同一时刻的多个零时长环节靠插入顺序稳定排列。
        .orderBy(asc(activitySegment.startTime), asc(activitySegment.id)),
    ]);

    return c.json(ok({ lines, segments }));
  })

  // ------------------------------------------------------------------ 环节 --

  .post("/api/createSegment", jsonBody(CreateSegmentInput), async (c) => {
    const { activityId, agendaLineId, ...input } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(
      async (tx): Promise<TxResult<SegmentRow>> => {
        const line = await lockLine(tx, activityId, agendaLineId, userId);
        if (!line.ok) return { kind: "invalid", message: line.message };

        const conflict = await findOverlap(
          tx,
          line.lineId,
          input.startTime,
          input.endTime,
        );
        if (conflict) {
          return { kind: "invalid", message: overlapMessage(conflict.name) };
        }

        const [row] = await tx
          .insert(activitySegment)
          .values({
            ...input,
            activityId,
            agendaLineId: line.lineId,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning(segmentFields);

        await recordRevision(tx, row.id, "create", row, userId);
        return { kind: "ok", row };
      },
    );

    if (result.kind === "invalid") return c.json(invalid(result.message));
    if (result.kind === "notFound") return c.json(segmentNotFound());
    return c.json(ok(result.row));
  })

  .post("/api/updateSegment", jsonBody(UpdateSegmentInput), async (c) => {
    const { id, agendaLineId, ...input } = c.req.valid("json");
    const userId = c.get("authedUser").id;

    const result = await db.transaction(
      async (tx): Promise<TxResult<SegmentRow>> => {
        // 这里必须先查：activityId 不在入参里（环节不支持改挂到别的活动），
        // 而 lockLine 需要它来校验目标线的归属。
        const [existing] = await tx
          .select({
            activityId: activitySegment.activityId,
            status: activitySegment.status,
          })
          .from(activitySegment)
          .where(eq(activitySegment.id, id));

        if (!existing) return { kind: "notFound" };

        const line = await lockLine(
          tx,
          existing.activityId,
          agendaLineId,
          userId,
        );
        if (!line.ok) return { kind: "invalid", message: line.message };

        // 作废环节不占时间段，改它的时间自然也不用查重叠——它重新占位是在
        // 恢复成正常的那一刻，那次检查在 setSegmentStatus 里。
        if (existing.status === "active") {
          const conflict = await findOverlap(
            tx,
            line.lineId,
            input.startTime,
            input.endTime,
            id,
          );
          if (conflict) {
            return { kind: "invalid", message: overlapMessage(conflict.name) };
          }
        }

        const [row] = await tx
          .update(activitySegment)
          .set({ ...input, agendaLineId: line.lineId, updatedBy: userId })
          .where(eq(activitySegment.id, id))
          .returning(segmentFields);

        await recordRevision(tx, row.id, "update", row, userId);
        return { kind: "ok", row };
      },
    );

    if (result.kind === "notFound") return c.json(segmentNotFound());
    if (result.kind === "invalid") return c.json(invalid(result.message));
    return c.json(ok(result.row));
  })

  .post(
    "/api/setSegmentStatus",
    jsonBody(SetSegmentStatusInput),
    async (c) => {
      const { id, status } = c.req.valid("json");
      const userId = c.get("authedUser").id;

      const result = await db.transaction(
        async (tx): Promise<TxResult<SegmentRow>> => {
          const [existing] = await tx
            .select({
              activityId: activitySegment.activityId,
              agendaLineId: activitySegment.agendaLineId,
              status: activitySegment.status,
              startTime: activitySegment.startTime,
              endTime: activitySegment.endTime,
            })
            .from(activitySegment)
            .where(eq(activitySegment.id, id));

          if (!existing) return { kind: "notFound" };

          // 最容易漏的一条：作废期间它让出的时段可能已经被别人占了，
          // 恢复成正常时要重新参与重叠校验。作废方向不需要检查。
          if (status === "active" && existing.status === "voided") {
            const line = await lockLine(
              tx,
              existing.activityId,
              existing.agendaLineId,
              userId,
            );
            if (!line.ok) return { kind: "invalid", message: line.message };

            const conflict = await findOverlap(
              tx,
              line.lineId,
              existing.startTime,
              existing.endTime,
              id,
            );
            if (conflict) {
              return {
                kind: "invalid",
                message: `恢复失败：${overlapMessage(conflict.name)}`,
              };
            }
          }

          const [row] = await tx
            .update(activitySegment)
            .set({ status, updatedBy: userId })
            .where(eq(activitySegment.id, id))
            .returning(segmentFields);

          await recordRevision(tx, row.id, "status", row, userId);
          return { kind: "ok", row };
        },
      );

      if (result.kind === "notFound") return c.json(segmentNotFound());
      if (result.kind === "invalid") return c.json(invalid(result.message));
      return c.json(ok(result.row));
    },
  )

  // 故意没有 /api/deleteSegment——BR-DEV-021：已被引用的环节不物理删除。
  // status = "voided" 就是这张表的删除通道，同时留两个出口只会让每个调用方
  // 自己纠结用哪个。

  // ---------------------------------------------------------------- 议程线 --

  .post(
    "/api/createAgendaLine",
    jsonBody(CreateAgendaLineInput),
    async (c) => {
      const { activityId, name, sortOrder } = c.req.valid("json");
      const userId = c.get("authedUser").id;

      // 只建并行线。主线由 createSegment 懒创建——两条创建路径就要各写一遍
      // 唯一约束冲突处理，而主线本来也没什么好填的（名字可选、排序恒 0）。
      const [row] = await db
        .insert(agendaLine)
        .values({
          activityId,
          lineType: "parallel",
          name,
          sortOrder,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(lineFields);

      return c.json(ok(row));
    },
  )

  .post(
    "/api/updateAgendaLine",
    jsonBody(UpdateAgendaLineInput),
    async (c) => {
      const { id, name, sortOrder } = c.req.valid("json");

      const [existing] = await db
        .select({ lineType: agendaLine.lineType })
        .from(agendaLine)
        .where(eq(agendaLine.id, id));

      if (!existing) return c.json(lineNotFound());

      // 主线的名字可以清空（前端展示回"主线"），并行线不行——不然时间轴上
      // 会出现一条没有标识的泳道。要拿到目标行才知道该不该必填，所以这条
      // 校验在这里而不在 zod 里。
      if (existing.lineType === "parallel" && !name) {
        return c.json(invalid("并行线必须填写线路名称"));
      }

      const [row] = await db
        .update(agendaLine)
        .set({
          name: name ?? null,
          // 主线永远画在第一层，排序值对它没有意义，强制归 0 免得数据里
          // 留下一个看着像生效实际不生效的值。
          sortOrder: existing.lineType === "main" ? 0 : sortOrder,
          updatedBy: c.get("authedUser").id,
        })
        .where(eq(agendaLine.id, id))
        .returning(lineFields);

      return c.json(ok(row));
    },
  )

  .post("/api/deleteAgendaLine", jsonBody(AgendaLineIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const result = await db.transaction(
      async (tx): Promise<TxResult<null>> => {
        const [existing] = await tx
          .select({ lineType: agendaLine.lineType })
          .from(agendaLine)
          .where(eq(agendaLine.id, id))
          .for("update");

        if (!existing) return { kind: "notFound" };

        // 主线是懒创建出来的、且是环节的默认归属，删掉它只会让下一个环节
        // 再建一条一模一样的。没有意义，直接不允许。
        if (existing.lineType === "main") {
          return { kind: "invalid", message: "主线不能删除" };
        }

        // 含作废环节一起算：作废环节仍然指着这条线，删线会留下悬空引用
        // （外键会直接拒绝），提前给一句人话。
        const [{ total }] = await tx
          .select({ total: count() })
          .from(activitySegment)
          .where(eq(activitySegment.agendaLineId, id));

        if (total > 0) {
          return {
            kind: "invalid",
            message: `这条并行线下还有 ${total} 个环节（含作废），请先把环节移到其他议程线`,
          };
        }

        await tx.delete(agendaLine).where(eq(agendaLine.id, id));
        return { kind: "ok", row: null };
      },
    );

    if (result.kind === "notFound") return c.json(lineNotFound());
    if (result.kind === "invalid") return c.json(invalid(result.message));
    return c.json(ok(result.row));
  });
