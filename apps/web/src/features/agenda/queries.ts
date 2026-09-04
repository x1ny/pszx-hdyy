import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// ---------------------------------------------------------------------------
// 领域类型全部从接口反推，不手抄——见 supplier/-queries.ts 的同一段注释。
// ---------------------------------------------------------------------------

export type Agenda = ApiData<
  InferResponseType<typeof api.api.agenda.list.$post>
>;
export type AgendaLine = Agenda["lines"][number];
export type Segment = Agenda["segments"][number];

export type SegmentType = Segment["segmentType"];
export type SegmentStatus = Segment["status"];
export type AgendaLineType = AgendaLine["lineType"];

export type SegmentFormValues = InferRequestType<
  typeof api.api.agenda.createSegment.$post
>["json"];
export type UpdateSegmentValues = InferRequestType<
  typeof api.api.agenda.updateSegment.$post
>["json"];

export const agendaKeys = {
  all: ["agenda"] as const,
  detail: (activityId: number) => [...agendaKeys.all, activityId] as const,
};

/**
 * 一次拿全量：时间轴要算轴范围和并行区块，必须看到全部环节；作废环节也一起
 * 返回，由视图各自过滤（时间轴只画正常的，列表可切换显示）。因此统计磁贴
 * 直接从这一份数据算，没有单独的 stats 接口。
 */
export const agendaQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: agendaKeys.detail(activityId),
    queryFn: () => unwrap(api.api.agenda.list.$post({ json: { activityId } })),
  });

// 变更操作只导出裸函数，useMutation 留在页面里写。

export const createSegment = (values: SegmentFormValues) =>
  unwrap(api.api.agenda.createSegment.$post({ json: values }));

export const updateSegment = (values: UpdateSegmentValues) =>
  unwrap(api.api.agenda.updateSegment.$post({ json: values }));

export const setSegmentStatus = (id: number, status: SegmentStatus) =>
  unwrap(api.api.agenda.setSegmentStatus.$post({ json: { id, status } }));

export const createAgendaLine = (values: {
  activityId: number;
  name: string;
  sortOrder: number;
}) => unwrap(api.api.agenda.createLine.$post({ json: values }));

export const updateAgendaLine = (values: {
  id: number;
  name?: string;
  sortOrder: number;
}) => unwrap(api.api.agenda.updateLine.$post({ json: values }));

export const deleteAgendaLine = (id: number) =>
  unwrap(api.api.agenda.deleteLine.$post({ json: { id } }));
