import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// 领域类型全部从接口反推，不手抄——手抄的那份会悄悄跟服务端漂移。
// 走的是 `@repo/server/client-type` 的类型通道，纯 import type，不进浏览器包。

export type Venue = ApiData<InferResponseType<typeof api.api.venue.get.$post>>;
export type VenueStatus = Venue["status"];

/** 列表行比详情多两个统计数，单独取一个类型。 */
export type VenueListRow = ApiData<
  InferResponseType<typeof api.api.venue.list.$post>
>["list"][number];

export type VenueFilters = InferRequestType<
  typeof api.api.venue.list.$post
>["json"];

export type VenueFormValues = InferRequestType<
  typeof api.api.venue.create.$post
>["json"];

/** getLayout 一次给全：场地本身 + 画布 blob + 投影出来的区域和位置。 */
export type VenueLayoutBundle = ApiData<
  InferResponseType<typeof api.api.venue.getLayout.$post>
>;

export type SaveVenueLayoutInput = InferRequestType<
  typeof api.api.venue.saveLayout.$post
>["json"];

export const venueKeys = {
  all: ["venue"] as const,
  list: (filters: VenueFilters) => [...venueKeys.all, "list", filters] as const,
  detail: (id: number) => [...venueKeys.all, "detail", id] as const,
  layout: (id: number) => [...venueKeys.all, "layout", id] as const,
  stats: () => [...venueKeys.all, "stats"] as const,
};

export const venueListQueryOptions = (filters: VenueFilters) =>
  queryOptions({
    queryKey: venueKeys.list(filters),
    queryFn: () => unwrap(api.api.venue.list.$post({ json: filters })),
    // 翻页时先留着上一页，避免表格塌成骨架屏再弹回来。
    placeholderData: keepPreviousData,
  });

export const venueStatsQueryOptions = () =>
  queryOptions({
    queryKey: venueKeys.stats(),
    queryFn: () => unwrap(api.api.venue.stats.$post({ json: {} })),
  });

/**
 * 画布页可能是被直接粘贴 URL 打开的，那时列表根本没加载过。
 * 所以走一次完整的 getLayout，不从列表缓存里捞。
 */
export const venueLayoutQueryOptions = (venueId: number) =>
  queryOptions({
    queryKey: venueKeys.layout(venueId),
    queryFn: () => unwrap(api.api.venue.getLayout.$post({ json: { venueId } })),
  });

// 变更操作只导出裸函数，useMutation 留在页面里——成功提示、关弹窗、
// 失效哪些查询都是页面的编排逻辑。

export const createVenue = (values: VenueFormValues) =>
  unwrap(api.api.venue.create.$post({ json: values }));

export const updateVenue = (values: VenueFormValues & { id: number }) =>
  unwrap(api.api.venue.update.$post({ json: values }));

export const deleteVenue = (id: number) =>
  unwrap(api.api.venue.delete.$post({ json: { id } }));

export const setVenueStatus = (id: number, status: VenueStatus) =>
  unwrap(api.api.venue.setStatus.$post({ json: { id, status } }));

export const saveVenueLayout = (input: SaveVenueLayoutInput) =>
  unwrap(api.api.venue.saveLayout.$post({ json: input }));
