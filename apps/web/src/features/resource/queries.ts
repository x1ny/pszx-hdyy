import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// 资源域的查询/变更放 features/ 而不是某个路由的 -queries.ts：议程页的环节
// 资源需求弹窗、资源需求汇总页、资源台账页三个消费方都要用，而它们分别住在
// 三个不相邻的路由目录下，谁 import 谁都是跨路由深路径。同 features/member。
//
// 后端把两层挂在两个前缀上（/api/resourceDemand、/api/activityResource），
// 这里照着分两组，不做统一封装——声明层是全量不分页、记录层是分页带筛选，
// 硬抽一层泛型只会把类型糊掉。

// ---------------------------------------------------------------------------
// 环节资源需求项（声明层）
// ---------------------------------------------------------------------------

export type ResourceDemand = ApiData<
  InferResponseType<typeof api.api.resourceDemand.list.$post>
>["list"][number];

export type ResourceType = ResourceDemand["resourceType"];
export type DemandHandling = ResourceDemand["handling"];
export type DemandStatus = ResourceDemand["status"];

export type SaveSegmentDemandsValues = InferRequestType<
  typeof api.api.resourceDemand.saveForSegment.$post
>["json"];

export type DemandItemValues = SaveSegmentDemandsValues["demands"][number];

export const resourceDemandKeys = {
  all: ["resourceDemand"] as const,
  list: (activityId: number) =>
    [...resourceDemandKeys.all, "list", activityId] as const,
};

/**
 * 一个活动的全部需求项。全量不分页，所以议程页的 chip、汇总页的表格和统计
 * 磁贴共用这一份缓存——三个视图各自过滤，不各发一次请求。
 */
export const resourceDemandListQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: resourceDemandKeys.list(activityId),
    queryFn: () =>
      unwrap(api.api.resourceDemand.list.$post({ json: { activityId } })),
  });

export const saveSegmentDemands = (json: SaveSegmentDemandsValues) =>
  unwrap(api.api.resourceDemand.saveForSegment.$post({ json }));

// ---------------------------------------------------------------------------
// 活动级资源台账（记录层）
// ---------------------------------------------------------------------------

export type ActivityResource = ApiData<
  InferResponseType<typeof api.api.activityResource.list.$post>
>["list"][number];

export type ResourceDetail = ApiData<
  InferResponseType<typeof api.api.activityResource.get.$post>
>;

export type ResourceStatus = ActivityResource["status"];
export type TransportScene = NonNullable<ActivityResource["transportScene"]>;

export type ResourceFilters = InferRequestType<
  typeof api.api.activityResource.list.$post
>["json"];

export type CreateResourceValues = InferRequestType<
  typeof api.api.activityResource.create.$post
>["json"];

export type UpdateResourceValues = InferRequestType<
  typeof api.api.activityResource.update.$post
>["json"];

export const activityResourceKeys = {
  all: ["activityResource"] as const,
  list: (filters: ResourceFilters) =>
    [...activityResourceKeys.all, "list", filters] as const,
  detail: (id: number) => [...activityResourceKeys.all, "detail", id] as const,
  stats: (activityId: number) =>
    [...activityResourceKeys.all, "stats", activityId] as const,
};

export const activityResourceListQueryOptions = (filters: ResourceFilters) =>
  queryOptions({
    queryKey: activityResourceKeys.list(filters),
    queryFn: () =>
      unwrap(api.api.activityResource.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const activityResourceDetailQueryOptions = (id: number | undefined) =>
  queryOptions({
    queryKey: activityResourceKeys.detail(id ?? 0),
    queryFn: () =>
      unwrap(api.api.activityResource.get.$post({ json: { id: id as number } })),
    enabled: id !== undefined,
  });

/** 统计不带筛选：数字跟着筛选跳的话就没法当参照系了。 */
export const activityResourceStatsQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: activityResourceKeys.stats(activityId),
    queryFn: () =>
      unwrap(api.api.activityResource.stats.$post({ json: { activityId } })),
  });

export const createResource = (json: CreateResourceValues) =>
  unwrap(api.api.activityResource.create.$post({ json }));

export const updateResource = (json: UpdateResourceValues) =>
  unwrap(api.api.activityResource.update.$post({ json }));

export const setResourceStatus = (id: number, status: ResourceStatus) =>
  unwrap(api.api.activityResource.setStatus.$post({ json: { id, status } }));

export const bindResourceMembers = (resourceId: number, memberIds: number[]) =>
  unwrap(
    api.api.activityResource.bindMembers.$post({
      json: { resourceId, memberIds },
    }),
  );

export const unbindResourceMember = (id: number) =>
  unwrap(api.api.activityResource.unbindMember.$post({ json: { id } }));
