import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// 领域类型全部从接口反推，不手抄——见 supplier/-queries.ts 的同一段注释。

export type SegmentConfig = ApiData<
  InferResponseType<typeof api.api.agenda.getSegmentConfig.$post>
>;

export type ConfigMember = SegmentConfig["members"][number];
export type ConfigDemand = SegmentConfig["demands"][number];
export type ConfigResource = ConfigDemand["resources"][number];
export type ConfigBinding = ConfigResource["bindings"][number];

export type SaveSegmentConfigValues = InferRequestType<
  typeof api.api.agenda.saveSegmentConfig.$post
>["json"];

export const segmentConfigKeys = {
  all: ["segmentConfig"] as const,
  detail: (segmentId: number) => [...segmentConfigKeys.all, segmentId] as const,
};

/**
 * 环节配置页的一次性读取。四块内容一起回来——它们是一屏显示的，拆开只会给
 * 首屏排一条瀑布（需求 → 资源 → 绑定本来就是父子依赖）。
 */
export const segmentConfigQueryOptions = (segmentId: number) =>
  queryOptions({
    queryKey: segmentConfigKeys.detail(segmentId),
    queryFn: () =>
      unwrap(api.api.agenda.getSegmentConfig.$post({ json: { segmentId } })),
  });

export const saveSegmentConfig = (json: SaveSegmentConfigValues) =>
  unwrap(api.api.agenda.saveSegmentConfig.$post({ json }));
