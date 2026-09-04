import { asc, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { type AuthedVariables, requireUser } from "../auth";
import { activitySegment, agendaLine } from "./schema";
import {
  findOverlap,
  lockLine,
  overlapMessage,
  recordRevision,
  type SegmentRow,
  segmentFields,
} from "./segment-write";
import {
  AgendaLineIdInput,
  CreateAgendaLineInput,
  CreateSegmentInput,
  ListAgendaInput,
  SetSegmentStatusInput,
  UpdateAgendaLineInput,
  UpdateSegmentInput,
} from "./validation";

// 显式字段投影：表上加一列不会顺带改掉 API 契约，也不会把 createdBy 这种
// 内部字段发到浏览器。
const lineFields = {
  id: agendaLine.id,
  activityId: agendaLine.activityId,
  lineType: agendaLine.lineType,
  name: agendaLine.name,
  sortOrder: agendaLine.sortOrder,
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

export const agendaRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  // ------------------------------------------------------------------ 查询 --

  .post("/list", jsonBody(ListAgendaInput), async (c) => {
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

  .post("/createSegment", jsonBody(CreateSegmentInput), async (c) => {
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

  .post("/updateSegment", jsonBody(UpdateSegmentInput), async (c) => {
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

  .post("/setSegmentStatus", jsonBody(SetSegmentStatusInput), async (c) => {
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
  })

  // 故意没有 deleteSegment 接口——BR-DEV-021：已被引用的环节不物理删除。
  // status = "voided" 就是这张表的删除通道，同时留两个出口只会让每个调用方
  // 自己纠结用哪个。

  // ---------------------------------------------------------------- 议程线 --

  .post("/createLine", jsonBody(CreateAgendaLineInput), async (c) => {
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
  })

  .post("/updateLine", jsonBody(UpdateAgendaLineInput), async (c) => {
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
  })

  .post("/deleteLine", jsonBody(AgendaLineIdInput), async (c) => {
    const { id } = c.req.valid("json");

    const result = await db.transaction(async (tx): Promise<TxResult<null>> => {
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
    });

    if (result.kind === "notFound") return c.json(lineNotFound());
    if (result.kind === "invalid") return c.json(invalid(result.message));
    return c.json(ok(result.row));
  });
