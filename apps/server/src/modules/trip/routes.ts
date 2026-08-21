import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../infra/db";
import { toLimitOffset } from "../../shared/pagination";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { activityMember, member } from "../member/schema";
import { activity, project } from "../project/schema";
import { memberTrip } from "./schema";
import {
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

const selectTrips = () =>
  db
    .select(tripFields)
    .from(memberTrip)
    .innerJoin(project, eq(project.id, memberTrip.projectId))
    .innerJoin(activity, eq(activity.id, memberTrip.activityId))
    .innerJoin(member, eq(member.id, memberTrip.memberId))
    .leftJoin(activitySegment, eq(activitySegment.id, memberTrip.segmentId));

/**
 * 从活动人员关系反查项目和人员，避免让客户端传两个能互相矛盾的 id。
 * 可选环节也在这里校验归属；数据库复合外键是最后一道并发兜底。
 */
async function resolveContext(
  activityId: number,
  activityMemberId: number,
  segmentId: number | null,
) {
  const [relation, segment] = await Promise.all([
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
      : db
          .select({ id: activitySegment.id })
          .from(activitySegment)
          .where(
            and(
              eq(activitySegment.id, segmentId),
              eq(activitySegment.activityId, activityId),
            ),
          )
          .limit(1)
          .then(([row]) => row),
  ]);

  if (!relation[0])
    return { ok: false as const, message: "所选人员不属于当前活动" };
  if (segmentId !== null && !segment) {
    return { ok: false as const, message: "所选环节不属于当前活动" };
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
      db
        .select({
          id: activitySegment.id,
          name: activitySegment.name,
          status: activitySegment.status,
        })
        .from(activitySegment)
        .where(eq(activitySegment.activityId, activityId))
        .orderBy(asc(activitySegment.startTime), asc(activitySegment.id)),
    ]);

    return c.json(ok({ members, segments }));
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
