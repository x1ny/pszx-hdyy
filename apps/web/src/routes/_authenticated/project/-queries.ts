import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// ---------------------------------------------------------------------------
// 领域类型全部从接口反推，不手抄——见 supplier/-queries.ts 的同一段注释。
// ---------------------------------------------------------------------------

export type Project = ApiData<
  InferResponseType<typeof api.api.project.get.$post>
>;
export type ProjectListItem = ApiData<
  InferResponseType<typeof api.api.project.list.$post>
>["list"][number];
export type ProjectPublishStatus = Project["publishStatus"];

export type ProjectFilters = InferRequestType<
  typeof api.api.project.list.$post
>["json"];
export type ProjectFormValues = InferRequestType<
  typeof api.api.project.create.$post
>["json"];

/**
 * 列表行。**从 /list 反推，不是从 /get** ——两个接口的投影不再相同：详情多
 * 带一个 `projectName`（活动可以被人直接甩个链接打开，那时"属于哪个项目"
 * 是缺失信息；而列表永远是从项目详情点进来的，每行重复项目名是噪音）。
 *
 * 之前两处共用一个从 /get 反推的 `Activity`，加完 projectName 之后项目详情页
 * 的列表行立刻编译不过——那正是这个拆分该发生的信号，不是要去给列表补一个
 * 它不需要的字段。
 */
export type Activity = ApiData<
  InferResponseType<typeof api.api.activity.list.$post>
>["list"][number];

/** 活动详情，比列表行多 `projectName`。 */
export type ActivityDetail = ApiData<
  InferResponseType<typeof api.api.activity.get.$post>
>;

export type ActivityType = Activity["activityType"];
// 活动没有单独一份 publishStatus 联合类型——它和项目共用同一套取值
// （schema.ts 里也是同一个 PUBLISH_STATUSES 常量），这里直接复用
// ProjectPublishStatus，不再声明一遍同名同值的类型。

export type ActivityFilters = InferRequestType<
  typeof api.api.activity.list.$post
>["json"];
export type ActivityFormValues = InferRequestType<
  typeof api.api.activity.create.$post
>["json"];
export type UpdateActivityValues = InferRequestType<
  typeof api.api.activity.update.$post
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
    queryFn: () => unwrap(api.api.project.list.$post({ json: filters })),
    // 翻页/改筛选时先展示上一页数据，避免表格整体塌成骨架屏再弹回来。
    placeholderData: keepPreviousData,
  });

export const projectDetailQueryOptions = (id: number) =>
  queryOptions({
    queryKey: projectKeys.detail(id),
    queryFn: () => unwrap(api.api.project.get.$post({ json: { id } })),
  });

export const activityListQueryOptions = (filters: ActivityFilters) =>
  queryOptions({
    queryKey: activityKeys.list(filters),
    queryFn: () => unwrap(api.api.activity.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const activityDetailQueryOptions = (id: number) =>
  queryOptions({
    queryKey: activityKeys.detail(id),
    queryFn: () => unwrap(api.api.activity.get.$post({ json: { id } })),
  });

// 变更操作只导出裸函数，useMutation 留在页面里写——成功提示、关弹窗、
// 失效哪些查询都是页面的编排逻辑。

export const createProject = (values: ProjectFormValues) =>
  unwrap(api.api.project.create.$post({ json: values }));

export const updateProject = (values: ProjectFormValues & { id: number }) =>
  unwrap(api.api.project.update.$post({ json: values }));

export const setProjectPublishStatus = (
  id: number,
  publishStatus: ProjectPublishStatus,
) =>
  unwrap(
    api.api.project.setPublishStatus.$post({ json: { id, publishStatus } }),
  );

export const deleteProject = (id: number) =>
  unwrap(api.api.project.delete.$post({ json: { id } }));

export const createActivity = (values: ActivityFormValues) =>
  unwrap(api.api.activity.create.$post({ json: values }));

export const updateActivity = (values: UpdateActivityValues) =>
  unwrap(api.api.activity.update.$post({ json: values }));

export const setActivityPublishStatus = (
  id: number,
  publishStatus: ProjectPublishStatus,
) =>
  unwrap(
    api.api.activity.setPublishStatus.$post({ json: { id, publishStatus } }),
  );

export const setActivityDisplayEnabled = (
  id: number,
  displayEnabled: boolean,
) =>
  unwrap(
    api.api.activity.setDisplayEnabled.$post({ json: { id, displayEnabled } }),
  );

export const setActivityRegistrationEnabled = (
  id: number,
  registrationEnabled: boolean,
) =>
  unwrap(
    api.api.activity.setRegistrationEnabled.$post({
      json: { id, registrationEnabled },
    }),
  );
