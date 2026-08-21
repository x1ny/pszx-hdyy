import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

/**
 * 活动场地空间 + 环节排位的查询层。
 *
 * 领域类型一律从接口反推，不手抄——手抄的那份会悄悄跟服务端漂移。
 */

// ---------------------------------------------------------------------------
// 活动场地空间
// ---------------------------------------------------------------------------

export type ActivityVenueBundle = ApiData<
  InferResponseType<typeof api.api.activityVenue.list.$post>
>;

export type ActivityVenueRow = ActivityVenueBundle["venues"][number];
export type ActivityVenueZoneRow = ActivityVenueBundle["zones"][number];
export type ActivityVenueLayoutRow = ActivityVenueBundle["layouts"][number];

export type ZonePurpose = ActivityVenueZoneRow["purpose"];
export type ActivityVenueStatus = ActivityVenueZoneRow["status"];

export type UpdateActivityVenueZoneInput = InferRequestType<
  typeof api.api.activityVenue.updateZone.$post
>["json"];

export const activityVenueKeys = {
  all: ["activityVenue"] as const,
  list: (activityId: number) =>
    [...activityVenueKeys.all, "list", activityId] as const,
  stats: (activityId: number) =>
    [...activityVenueKeys.all, "stats", activityId] as const,
};

export const activityVenueListQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: activityVenueKeys.list(activityId),
    queryFn: () =>
      unwrap(api.api.activityVenue.list.$post({ json: { activityId } })),
  });

export const activityVenueStatsQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: activityVenueKeys.stats(activityId),
    queryFn: () =>
      unwrap(api.api.activityVenue.stats.$post({ json: { activityId } })),
  });

export const importActivityVenue = (activityId: number, venueId: number) =>
  unwrap(api.api.activityVenue.import.$post({ json: { activityId, venueId } }));

export const removeActivityVenue = (id: number) =>
  unwrap(api.api.activityVenue.remove.$post({ json: { id } }));

export const updateActivityVenueZone = (input: UpdateActivityVenueZoneInput) =>
  unwrap(api.api.activityVenue.updateZone.$post({ json: input }));

export const setActivityVenueZoneStatus = (
  id: number,
  status: ActivityVenueStatus,
) =>
  unwrap(api.api.activityVenue.setZoneStatus.$post({ json: { id, status } }));

/** 一份活动场地自己的画布 + 区域，够开一次编辑器会话——跟 venue 模块的 getLayout 同构。 */
export type ActivityVenueLayoutBundle = ApiData<
  InferResponseType<typeof api.api.activityVenue.getLayout.$post>
>;

export type SaveActivityVenueLayoutInput = InferRequestType<
  typeof api.api.activityVenue.saveLayout.$post
>["json"];

export const activityVenueLayoutQueryOptions = (activityVenueId: number) =>
  queryOptions({
    queryKey: [...activityVenueKeys.all, "layout", activityVenueId] as const,
    queryFn: () =>
      unwrap(
        api.api.activityVenue.getLayout.$post({ json: { activityVenueId } }),
      ),
  });

export const saveActivityVenueLayout = (input: SaveActivityVenueLayoutInput) =>
  unwrap(api.api.activityVenue.saveLayout.$post({ json: input }));

// ---------------------------------------------------------------------------
// 环节排位
// ---------------------------------------------------------------------------

export type SeatingPlanRow = ApiData<
  InferResponseType<typeof api.api.seating.listPlans.$post>
>["list"][number];

export type PlanStatus = NonNullable<SeatingPlanRow["plan"]>["status"];

export type SeatingPlanBundle = ApiData<
  InferResponseType<typeof api.api.seating.getPlan.$post>
>;

export type PlanSeatRow = SeatingPlanBundle["seats"][number];
export type PlanAssignmentRow = SeatingPlanBundle["assignments"][number];

export type SeatingCandidate = ApiData<
  InferResponseType<typeof api.api.seating.listCandidates.$post>
>["list"][number];

export type ZoneUsageRow = ApiData<
  InferResponseType<typeof api.api.seating.zoneUsage.$post>
>["list"][number];

export type CreatePlanInput = InferRequestType<
  typeof api.api.seating.createPlan.$post
>["json"];

export type SavePlanLayoutInput = InferRequestType<
  typeof api.api.seating.saveLayout.$post
>["json"];

export const seatingKeys = {
  all: ["seating"] as const,
  plans: (activityId: number) =>
    [...seatingKeys.all, "plans", activityId] as const,
  plan: (planId: number) => [...seatingKeys.all, "plan", planId] as const,
  zoneUsage: (activityId: number) =>
    [...seatingKeys.all, "zoneUsage", activityId] as const,
  candidates: (planId: number, keyword?: string) =>
    [...seatingKeys.all, "candidates", planId, keyword ?? ""] as const,
};

export const seatingPlansQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: seatingKeys.plans(activityId),
    queryFn: () =>
      unwrap(api.api.seating.listPlans.$post({ json: { activityId } })),
  });

export const seatingPlanQueryOptions = (planId: number) =>
  queryOptions({
    queryKey: seatingKeys.plan(planId),
    queryFn: () => unwrap(api.api.seating.getPlan.$post({ json: { planId } })),
  });

/**
 * 每个活动区域被哪些环节排位引用。
 *
 * 场地空间页也用它——那一页的"被排位引用"卡片和"引用环节"列都来自这里。
 * **由 seating 提供而不是 venue 自己算**：venue 不认识 seating，前端多发一个
 * 请求也不能把依赖方向弄反。
 */
export const zoneUsageQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: seatingKeys.zoneUsage(activityId),
    queryFn: () =>
      unwrap(api.api.seating.zoneUsage.$post({ json: { activityId } })),
  });

export const seatingCandidatesQueryOptions = (
  planId: number,
  keyword?: string,
) =>
  queryOptions({
    queryKey: seatingKeys.candidates(planId, keyword),
    queryFn: () =>
      unwrap(
        api.api.seating.listCandidates.$post({ json: { planId, keyword } }),
      ),
  });

export const createSeatingPlan = (input: CreatePlanInput) =>
  unwrap(api.api.seating.createPlan.$post({ json: input }));

export const saveSeatingLayout = (input: SavePlanLayoutInput) =>
  unwrap(api.api.seating.saveLayout.$post({ json: input }));

export const assignSeat = (
  planId: number,
  segmentSeatId: number,
  segmentMemberId: number,
) =>
  unwrap(
    api.api.seating.assign.$post({
      json: { planId, segmentSeatId, segmentMemberId },
    }),
  );

export const assignActivityMemberToSeat = (
  planId: number,
  segmentSeatId: number,
  activityMemberId: number,
) =>
  unwrap(
    api.api.seating.assignActivityMember.$post({
      json: { planId, segmentSeatId, activityMemberId },
    }),
  );

export const unassignSeat = (planId: number, segmentSeatId: number) =>
  unwrap(api.api.seating.unassign.$post({ json: { planId, segmentSeatId } }));

/**
 * 本环节启用/停用一个位置。即时生效——排位阶段不再走"改几何 + 点保存"那条路，
 * 这个操作跟 assign/unassign 是同一类：点了就提交。
 */
export const setSeatEnabled = (
  planId: number,
  segmentSeatId: number,
  enabled: boolean,
) =>
  unwrap(
    api.api.seating.setSeatEnabled.$post({
      json: { planId, segmentSeatId, enabled },
    }),
  );

export const swapSeats = (planId: number, seatAId: number, seatBId: number) =>
  unwrap(api.api.seating.swap.$post({ json: { planId, seatAId, seatBId } }));

export const confirmSeatingPlan = (planId: number) =>
  unwrap(api.api.seating.confirm.$post({ json: { planId } }));

export const rejectSeatingPlan = (planId: number, reason: string) =>
  unwrap(api.api.seating.reject.$post({ json: { planId, reason } }));

export const voidSeatingPlan = (planId: number) =>
  unwrap(api.api.seating.void.$post({ json: { planId } }));
