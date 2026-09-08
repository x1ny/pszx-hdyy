import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// ---------------------------------------------------------------------------
// 领域类型全部从接口反推，不手抄。
//
// 手抄一份的代价是它会悄悄跟服务端漂移 —— 后端加个字段、改个可空性，前端照样
// 编译通过，直到运行时才炸。走的是既有的类型通道（`@repo/server/client-type`
// 的 hcWithType），纯 `import type`，不会把服务端代码带进浏览器包。
// ---------------------------------------------------------------------------

export type Itinerary = ApiData<
  InferResponseType<typeof api.api.h5.getItinerary.$post>
>;

export type ActivityInfo = Itinerary["activity"];
export type AgendaItem = Itinerary["agenda"][number];
export type Trip = Itinerary["trips"][number];
export type Car = Itinerary["cars"][number];

export type SeatMap = ApiData<
  InferResponseType<typeof api.api.h5.getSeatMap.$post>
>;

export const itineraryKeys = {
  all: ["itinerary"] as const,
  detail: (shareToken: string) => [...itineraryKeys.all, shareToken] as const,
  seatMap: (shareToken: string, segmentId: number) =>
    [...itineraryKeys.detail(shareToken), "seatMap", segmentId] as const,
};

export const itineraryQueryOptions = (shareToken: string) =>
  queryOptions({
    queryKey: itineraryKeys.detail(shareToken),
    queryFn: () =>
      unwrap(api.api.h5.getItinerary.$post({ json: { shareToken } })),
    /**
     * 不重试。**这个请求同时承担路由守卫的职责**（`beforeLoad` 拿它的
     * H5_UNAUTHORIZED 决定跳不跳手机号页），重试三次只会让没验证过的用户
     * 在白屏上多等两秒才被跳走。
     */
    retry: false,
  });

/**
 * 单个环节的座位图。**只在面板打开时才请求**（`enabled` 由调用方给）。
 *
 * 行程页那一份数据里只有一个 `hasSeatMap` 布尔值，画布本体在这条路上——一万座
 * 的方案不该让任何没点开座位图的人多等一秒。
 *
 * `staleTime` 给得长：已确认方案的座位在活动期间基本不动，而嘉宾很可能反复开合
 * 同一张图核对。真改了的话运营会重新确认，那时嘉宾刷新页面即可。
 */
export const seatMapQueryOptions = (
  shareToken: string,
  segmentId: number | null,
) =>
  queryOptions({
    queryKey: itineraryKeys.seatMap(shareToken, segmentId ?? 0),
    queryFn: () =>
      unwrap(
        api.api.h5.getSeatMap.$post({
          // enabled 保证了只有 segmentId 非空时才会跑到这里。
          json: { shareToken, segmentId: segmentId as number },
        }),
      ),
    enabled: segmentId !== null,
    staleTime: 5 * 60 * 1000,
  });

/** 提交手机号。成功后服务端下发 7 天的 HttpOnly cookie，前端不碰它。 */
export const submitPhone = (shareToken: string, mobile: string) =>
  unwrap(api.api.h5Access.submitPhone.$post({ json: { shareToken, mobile } }));
