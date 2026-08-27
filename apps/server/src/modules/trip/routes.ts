import { and, asc, count, desc, eq, ilike, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { activityMember, member, segmentMember } from "../member/schema";
import { organization } from "../organization/schema";
import { activity, project } from "../project/schema";
import { memberTrip } from "./schema";
import {
  BatchTripOptionsInput,
  CreateBatchTripsInput,
  CreateTripInput,
  ListMemberTripsInput,
  ListTripsInput,
  TripIdInput,
  TripOptionsInput,
  UpdateTripInput,
} from "./validation";

const tripFields = {
  id: memberTrip.id,
  projectId: memberTrip.projectId,
  projectName: project.name,
  activityId: memberTrip.activityId,
  activityName: activity.name,
  activityMemberId: memberTrip.activityMemberId,
  memberId: memberTrip.memberId,
  memberName: member.name,
  companyPosition: member.companyPosition,
  segmentId: memberTrip.segmentId,
  segmentName: activitySegment.name,
  transportMode: memberTrip.transportMode,
  serviceNumber: memberTrip.serviceNumber,
  departureTime: memberTrip.departureTime,
  arrivalTime: memberTrip.arrivalTime,
  departureLocation: memberTrip.departureLocation,
  destination: memberTrip.destination,
  createdAt: memberTrip.createdAt,
  updatedAt: memberTrip.updatedAt,
};

const notFound = () =>
  err({ code: "NOT_FOUND" as const, message: "行程不存在" });
const validationError = (message: string) =>
  err({ code: "VALIDATION_ERROR" as const, message });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BatchTripInput = z.infer<typeof CreateBatchTripsInput>;

/** 事务中的范围失败。抛出而不是返回半成品，确保整批写入会回滚。 */
export class BatchTripScopeError extends Error {}

const failBatchScope = (message: string): never => {
  throw new BatchTripScopeError(message);
};

/** Drizzle 可能把 Postgres 错误包在 cause 里，递归读取才不会漏掉并发兜底。 */
const hasDatabaseCode = (error: unknown, expectedCode: string): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return (
    code === expectedCode ||
    (cause !== undefined && hasDatabaseCode(cause, expectedCode))
  );
};

const selectTrips = () =>
  db
    .select(tripFields)
    .from(memberTrip)
    .innerJoin(project, eq(project.id, memberTrip.projectId))
    .innerJoin(activity, eq(activity.id, memberTrip.activityId))
    .innerJoin(member, eq(member.id, memberTrip.memberId))
    .leftJoin(activitySegment, eq(activitySegment.id, memberTrip.segmentId));

/**
 * 行程只能关联仍可维护环节人员的环节：作废环节和关闭环节人员管理的环节
 * 都不应出现在关联环节下拉框中。
 */
export const tripOptionsSegmentsQuery = (activityId: number) =>
  db
    .select({
      id: activitySegment.id,
      name: activitySegment.name,
      status: activitySegment.status,
    })
    .from(activitySegment)
    .where(
      and(
        eq(activitySegment.activityId, activityId),
        eq(activitySegment.status, "active"),
        eq(activitySegment.memberEnabled, true),
      ),
    )
    .orderBy(asc(activitySegment.startTime), asc(activitySegment.id));

/**
 * 团体选项必须从人员关系的 organizationId **快照**反查，而不是 member 主档：
 * 主档后来换团体后，已经进入活动/环节范围的人员不能跟着在选择器里漂移。
 */
export const tripBatchOrganizationsQuery = (
  activityId: number,
  segmentId: number | null,
) => {
  if (segmentId === null) {
    return db
      .selectDistinct({ id: organization.id, name: organization.name })
      .from(activityMember)
      .innerJoin(
        organization,
        eq(organization.id, activityMember.organizationId),
      )
      .where(eq(activityMember.activityId, activityId))
      .orderBy(asc(organization.name), asc(organization.id));
  }

  return db
    .selectDistinct({ id: organization.id, name: organization.name })
    .from(segmentMember)
    .innerJoin(organization, eq(organization.id, segmentMember.organizationId))
    .where(
      and(
        eq(segmentMember.activityId, activityId),
        eq(segmentMember.segmentId, segmentId),
      ),
    )
    .orderBy(asc(organization.name), asc(organization.id));
};

/**
 * 批量选择器的人员选项。带环节时由 segment_member 驱动，不能退化成全活动
 * activity_member，否则能给没参加该环节的人录入环节行程。
 */
export const tripBatchMembersQuery = (
  activityId: number,
  segmentId: number | null,
) => {
  if (segmentId === null) {
    return db
      .select({
        activityMemberId: activityMember.id,
        memberId: member.id,
        organizationId: activityMember.organizationId,
        name: member.name,
        companyPosition: member.companyPosition,
      })
      .from(activityMember)
      .innerJoin(member, eq(member.id, activityMember.memberId))
      .where(eq(activityMember.activityId, activityId))
      .orderBy(asc(member.name), asc(member.id), asc(activityMember.id));
  }

  return db
    .select({
      activityMemberId: segmentMember.activityMemberId,
      memberId: member.id,
      organizationId: segmentMember.organizationId,
      name: member.name,
      companyPosition: member.companyPosition,
    })
    .from(segmentMember)
    .innerJoin(member, eq(member.id, segmentMember.memberId))
    .where(
      and(
        eq(segmentMember.activityId, activityId),
        eq(segmentMember.segmentId, segmentId),
      ),
    )
    .orderBy(asc(member.name), asc(member.id), asc(segmentMember.id));
};

export type BatchTripScopeRow = {
  activityMemberId: number;
  projectId: number;
  memberId: number;
};

/**
 * 验证在任何 insert 前完成。检查时可用 Set 确认每个**不同**的 id 都在范围内，
 * 但返回时严格按原数组映射，绝不去重；同一个活动人员重复出现就会生成多条行程。
 */
export const resolveBatchTripScope = (
  activityMemberIds: readonly number[],
  scopeRows: readonly BatchTripScopeRow[],
  errorMessage: string,
) => {
  const scopeByActivityMemberId = new Map(
    scopeRows.map((row) => [row.activityMemberId, row]),
  );
  const requestedIds = new Set(activityMemberIds);

  for (const activityMemberId of requestedIds) {
    if (!scopeByActivityMemberId.has(activityMemberId)) {
      failBatchScope(errorMessage);
    }
  }

  return activityMemberIds.map(
    (activityMemberId) =>
      scopeByActivityMemberId.get(activityMemberId) ??
      failBatchScope(errorMessage),
  );
};

/**
 * 纯映射层让「一次 id 对应一条 insert」成为可单测的约束；范围行缺任何一个时
 * resolveBatchTripScope 已经 throw，调用方尚未取得值数组、更不可能部分写入。
 */
export const buildBatchTripRows = (
  input: BatchTripInput,
  scopeRows: readonly BatchTripScopeRow[],
  userId: string,
  errorMessage: string,
) =>
  resolveBatchTripScope(input.activityMemberIds, scopeRows, errorMessage).map(
    (scope) => ({
      projectId: scope.projectId,
      activityId: input.activityId,
      activityMemberId: scope.activityMemberId,
      memberId: scope.memberId,
      segmentId: input.segmentId,
      transportMode: input.transportMode,
      serviceNumber: input.serviceNumber,
      departureTime: input.departureTime,
      arrivalTime: input.arrivalTime,
      departureLocation: input.departureLocation,
      destination: input.destination,
      createdBy: userId,
      updatedBy: userId,
    }),
  );

/** 查询目标团体下的活动/环节范围行，供批量写入前的全集校验。 */
async function batchTripScopeRows(
  tx: Tx,
  input: BatchTripInput,
): Promise<BatchTripScopeRow[]> {
  const uniqueActivityMemberIds = [...new Set(input.activityMemberIds)];

  if (input.segmentId === null) {
    return tx
      .select({
        activityMemberId: activityMember.id,
        projectId: activityMember.projectId,
        memberId: activityMember.memberId,
      })
      .from(activityMember)
      .where(
        and(
          eq(activityMember.activityId, input.activityId),
          eq(activityMember.organizationId, input.organizationId),
          inArray(activityMember.id, uniqueActivityMemberIds),
        ),
      );
  }

  return tx
    .select({
      activityMemberId: activityMember.id,
      projectId: activityMember.projectId,
      memberId: activityMember.memberId,
    })
    .from(segmentMember)
    .innerJoin(
      activityMember,
      eq(activityMember.id, segmentMember.activityMemberId),
    )
    .where(
      and(
        eq(segmentMember.activityId, input.activityId),
        eq(segmentMember.segmentId, input.segmentId),
        eq(segmentMember.organizationId, input.organizationId),
        inArray(segmentMember.activityMemberId, uniqueActivityMemberIds),
      ),
    );
}

/** 单条行程关联环节时，活动人员必须确实位于该环节范围。 */
export const tripSegmentMembershipQuery = (
  activityId: number,
  activityMemberId: number,
  segmentId: number,
) =>
  db
    .select({ id: segmentMember.id })
    .from(segmentMember)
    .innerJoin(activitySegment, eq(activitySegment.id, segmentMember.segmentId))
    .where(
      and(
        eq(segmentMember.segmentId, segmentId),
        eq(segmentMember.activityMemberId, activityMemberId),
        eq(activitySegment.activityId, activityId),
      ),
    )
    .limit(1);

/**
 * 从活动人员关系反查项目和人员，避免让客户端传两个能互相矛盾的 id。
 * 可选环节也在这里校验归属；数据库复合外键是最后一道并发兜底。
 */
async function resolveContext(
  activityId: number,
  activityMemberId: number,
  segmentId: number | null,
) {
  const [relation, segmentMembership] = await Promise.all([
    db
      .select({
        projectId: activityMember.projectId,
        memberId: activityMember.memberId,
      })
      .from(activityMember)
      .where(
        and(
          eq(activityMember.id, activityMemberId),
          eq(activityMember.activityId, activityId),
        ),
      )
      .limit(1),
    segmentId === null
      ? Promise.resolve(undefined)
      : tripSegmentMembershipQuery(
          activityId,
          activityMemberId,
          segmentId,
        ).then(([row]) => row),
  ]);

  if (!relation[0])
    return { ok: false as const, message: "所选人员不属于当前活动" };
  if (segmentId !== null && !segmentMembership) {
    return { ok: false as const, message: "所选人员不在该环节范围内" };
  }

  return { ok: true as const, ...relation[0] };
}

export const tripRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /** 查询当前活动的人员行程。 */
  .post("/list", jsonBody(ListTripsInput), async (c) => {
    const { activityId, name, companyPosition, transportMode, page, pageSize } =
      c.req.valid("json");
    const where = and(
      eq(memberTrip.activityId, activityId),
      name ? ilike(member.name, `%${name}%`) : undefined,
      companyPosition
        ? ilike(member.companyPosition, `%${companyPosition}%`)
        : undefined,
      transportMode ? eq(memberTrip.transportMode, transportMode) : undefined,
    );
    const { limit, offset } = toLimitOffset({ page, pageSize });

    const [list, totalRows] = await Promise.all([
      selectTrips()
        .where(where)
        .orderBy(desc(memberTrip.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(memberTrip)
        .innerJoin(member, eq(member.id, memberTrip.memberId))
        .where(where),
    ]);

    return c.json(ok({ list, total: totalRows[0]?.total ?? 0 }));
  })

  /** 获取一条人员行程。 */
  .post("/get", jsonBody(TripIdInput), async (c) => {
    const [row] = await selectTrips().where(
      eq(memberTrip.id, c.req.valid("json").id),
    );
    return row ? c.json(ok(row)) : c.json(notFound());
  })

  /** 获取新增/修改表单所需的当前活动人员与环节选项。 */
  .post("/options", jsonBody(TripOptionsInput), async (c) => {
    const { activityId } = c.req.valid("json");
    const [members, segments] = await Promise.all([
      db
        .select({
          activityMemberId: activityMember.id,
          memberId: member.id,
          name: member.name,
          companyPosition: member.companyPosition,
        })
        .from(activityMember)
        .innerJoin(member, eq(member.id, activityMember.memberId))
        .where(eq(activityMember.activityId, activityId))
        .orderBy(asc(member.name), asc(member.id)),
      tripOptionsSegmentsQuery(activityId),
    ]);

    return c.json(ok({ members, segments }));
  })

  /**
   * 团体批量录入的范围选项。
   *
   * 未选环节时读取活动人员关系的 organizationId 快照；选了环节后，两组
   * 选项一律改由该 segment_member 的快照和关系驱动，主档后来换团体不会
   * 让可选项越过当时的环节范围。
   */
  .post("/batchOptions", jsonBody(BatchTripOptionsInput), async (c) => {
    const { activityId, segmentId } = c.req.valid("json");
    const [organizations, members] = await Promise.all([
      tripBatchOrganizationsQuery(activityId, segmentId),
      tripBatchMembersQuery(activityId, segmentId),
    ]);

    return c.json(ok({ organizations, members }));
  })

  /** 新增一条人员行程。 */
  .post("/create", jsonBody(CreateTripInput), async (c) => {
    const input = c.req.valid("json");
    const context = await resolveContext(
      input.activityId,
      input.activityMemberId,
      input.segmentId,
    );
    if (!context.ok) return c.json(validationError(context.message));

    const userId = c.get("authedUser").id;
    const [created] = await db
      .insert(memberTrip)
      .values({
        ...input,
        projectId: context.projectId,
        memberId: context.memberId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: memberTrip.id });

    const [row] = created
      ? await selectTrips().where(eq(memberTrip.id, created.id))
      : [];
    return c.json(ok(row));
  })

  /**
   * 为所选团体范围内的每个活动人员批量创建独立行程。
   *
   * 所有范围校验和 INSERT 位于同一事务：伪造人员/团体/环节 id 会在任何写入前
   * 抛错；数据库约束在并发变化时仍会回滚整批，绝不留下半批行程。输入数组刻意
   * 不去重，重复一个 activityMemberId 就代表要为该人新建多条独立行程。
   */
  .post("/createBatch", jsonBody(CreateBatchTripsInput), async (c) => {
    const input = c.req.valid("json");
    const rangeError =
      input.segmentId === null
        ? "所选团体或人员不在当前活动范围内"
        : "所选团体或人员不在所选环节范围内";

    try {
      const createdIds = await db.transaction(async (tx) => {
        const scopeRows = await batchTripScopeRows(tx, input);
        const values = buildBatchTripRows(
          input,
          scopeRows,
          c.get("authedUser").id,
          rangeError,
        );

        return tx
          .insert(memberTrip)
          .values(values)
          .returning({ id: memberTrip.id });
      });

      const ids = createdIds.map((row) => row.id);
      const list = await selectTrips()
        .where(inArray(memberTrip.id, ids))
        .orderBy(asc(memberTrip.id));

      return c.json(ok({ list }));
    } catch (error) {
      if (error instanceof BatchTripScopeError) {
        return c.json(validationError(error.message));
      }
      // 选项加载和提交之间，活动人员/环节关系可能被别人移除；约束此时负责
      // 回滚，接口仍给调用方一条可处理的业务错误而不是 500。
      if (hasDatabaseCode(error, "23503") || hasDatabaseCode(error, "23514")) {
        return c.json(validationError("批量创建行程失败，请刷新范围后重试"));
      }
      throw error;
    }
  })

  /** 修改一条人员行程。 */
  .post("/update", jsonBody(UpdateTripInput), async (c) => {
    const { id, ...input } = c.req.valid("json");
    const context = await resolveContext(
      input.activityId,
      input.activityMemberId,
      input.segmentId,
    );
    if (!context.ok) return c.json(validationError(context.message));

    const [updated] = await db
      .update(memberTrip)
      .set({
        ...input,
        projectId: context.projectId,
        memberId: context.memberId,
        updatedBy: c.get("authedUser").id,
      })
      .where(eq(memberTrip.id, id))
      .returning({ id: memberTrip.id });

    if (!updated) return c.json(notFound());
    const [row] = await selectTrips().where(eq(memberTrip.id, updated.id));
    return c.json(ok(row));
  })

  /** 删除一条人员行程。 */
  .post("/delete", jsonBody(TripIdInput), async (c) => {
    const [row] = await db
      .delete(memberTrip)
      .where(eq(memberTrip.id, c.req.valid("json").id))
      .returning({ id: memberTrip.id });
    return row ? c.json(ok(row)) : c.json(notFound());
  })

  /** 查询人员详情中的全部行程，按项目和时间展示。 */
  .post("/listByMember", jsonBody(ListMemberTripsInput), async (c) => {
    const list = await selectTrips()
      .where(eq(memberTrip.memberId, c.req.valid("json").memberId))
      .orderBy(desc(memberTrip.departureTime), desc(memberTrip.id));
    return c.json(ok({ list }));
  });
