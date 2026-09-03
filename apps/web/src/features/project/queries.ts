import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// ---------------------------------------------------------------------------
// 项目 + 活动是一个业务域（服务端也是同一个 modules/project），所以共用这一个
// feature 目录。它原先是 routes/_authenticated/project/-queries.ts —— 一级菜单
// 「活动管理」建起来之后，活动的类型和接口有了第二个路由子树的消费方，按
// docs/code-structure.md 的判据（业务逻辑第 2 个消费方就提升）搬到这里。
// ---------------------------------------------------------------------------

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
/** 「所属项目」下拉的选项，只有 id 和 name。 */
export type ProjectOption = ApiData<
  InferResponseType<typeof api.api.project.options.$post>
>[number];
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

/** 活动详情。和列表行的差别只有一个 `segmentCount`（详情页不展示环节数）。 */
export type ActivityDetail = ApiData<
  InferResponseType<typeof api.api.activity.get.$post>
>;

/**
 * 活动表单读的那批字段——列表行和详情行都满足。
 *
 * 表单在两处打开（活动列表的"修改"、活动详情页的"编辑活动信息"），两边手里的
 * 行来自不同接口、投影差一个字段。写成这个 Omit 而不是 `Activity | ActivityDetail`：
 * 表单不关心这点差异，联合类型只会把"哪边多一个字段"这种噪音漏给调用方。
 */
export type ActivityFormSource = Omit<Activity, "segmentCount">;

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
  options: () => [...projectKeys.all, "options"] as const,
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

/**
 * 全部项目的轻量选项，给「所属项目」下拉用。
 *
 * staleTime 给 5 分钟：项目不是高频变更的东西，而这个下拉在活动管理页每次
 * 进入都要用；新建项目后由 projectKeys.all 的 invalidate 一起失效。
 */
export const projectOptionsQueryOptions = () =>
  queryOptions({
    queryKey: projectKeys.options(),
    queryFn: () => unwrap(api.api.project.options.$post()),
    staleTime: 5 * 60 * 1000,
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

export const deleteActivity = (id: number) =>
  unwrap(api.api.activity.delete.$post({ json: { id } }));

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
