import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// ---------------------------------------------------------------------------
// 领域类型全部从接口反推，不手抄——见 supplier/-queries.ts 的同一段注释。
// ---------------------------------------------------------------------------

export type Project = ApiData<
  InferResponseType<typeof api.api.getProject.$post>
>;
export type ProjectPublishStatus = Project["publishStatus"];

export type ProjectFilters = InferRequestType<
  typeof api.api.listProjects.$post
>["json"];
export type ProjectFormValues = InferRequestType<
  typeof api.api.createProject.$post
>["json"];

export type Activity = ApiData<
  InferResponseType<typeof api.api.getActivity.$post>
>;
export type ActivityType = Activity["activityType"];
// 活动没有单独一份 publishStatus 联合类型——它和项目共用同一套取值
// （schema.ts 里也是同一个 PUBLISH_STATUSES 常量），这里直接复用
// ProjectPublishStatus，不再声明一遍同名同值的类型。

export type ActivityFilters = InferRequestType<
  typeof api.api.listActivities.$post
>["json"];
export type ActivityFormValues = InferRequestType<
  typeof api.api.createActivity.$post
>["json"];
export type UpdateActivityValues = InferRequestType<
  typeof api.api.updateActivity.$post
>["json"];

export const projectKeys = {
  all: ["project"] as const,
  list: (filters: ProjectFilters) =>
    [...projectKeys.all, "list", filters] as const,
  detail: (id: number) => [...projectKeys.all, "detail", id] as const,
};

export const activityKeys = {
  all: ["activity"] as const,
  list: (filters: ActivityFilters) =>
    [...activityKeys.all, "list", filters] as const,
  detail: (id: number) => [...activityKeys.all, "detail", id] as const,
};

export const projectListQueryOptions = (filters: ProjectFilters) =>
  queryOptions({
    queryKey: projectKeys.list(filters),
    queryFn: () => unwrap(api.api.listProjects.$post({ json: filters })),
    // 翻页/改筛选时先展示上一页数据，避免表格整体塌成骨架屏再弹回来。
    placeholderData: keepPreviousData,
  });

export const projectDetailQueryOptions = (id: number) =>
  queryOptions({
    queryKey: projectKeys.detail(id),
    queryFn: () => unwrap(api.api.getProject.$post({ json: { id } })),
  });

export const activityListQueryOptions = (filters: ActivityFilters) =>
  queryOptions({
    queryKey: activityKeys.list(filters),
    queryFn: () => unwrap(api.api.listActivities.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const activityDetailQueryOptions = (id: number) =>
  queryOptions({
    queryKey: activityKeys.detail(id),
    queryFn: () => unwrap(api.api.getActivity.$post({ json: { id } })),
  });

// 变更操作只导出裸函数，useMutation 留在页面里写——成功提示、关弹窗、
// 失效哪些查询都是页面的编排逻辑。

export const createProject = (values: ProjectFormValues) =>
  unwrap(api.api.createProject.$post({ json: values }));

export const updateProject = (values: ProjectFormValues & { id: number }) =>
  unwrap(api.api.updateProject.$post({ json: values }));

export const setProjectPublishStatus = (
  id: number,
  publishStatus: ProjectPublishStatus,
) =>
  unwrap(
    api.api.setProjectPublishStatus.$post({ json: { id, publishStatus } }),
  );

export const createActivity = (values: ActivityFormValues) =>
  unwrap(api.api.createActivity.$post({ json: values }));

export const updateActivity = (values: UpdateActivityValues) =>
  unwrap(api.api.updateActivity.$post({ json: values }));

export const setActivityPublishStatus = (
  id: number,
  publishStatus: ProjectPublishStatus,
) =>
  unwrap(
    api.api.setActivityPublishStatus.$post({ json: { id, publishStatus } }),
  );

export const setActivityDisplayEnabled = (
  id: number,
  displayEnabled: boolean,
) =>
  unwrap(
    api.api.setActivityDisplayEnabled.$post({ json: { id, displayEnabled } }),
  );

export const setActivityRegistrationEnabled = (
  id: number,
  registrationEnabled: boolean,
) =>
  unwrap(
    api.api.setActivityRegistrationEnabled.$post({
      json: { id, registrationEnabled },
    }),
  );
