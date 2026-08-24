import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// 三层人员关系的查询/变更，放 features/ 而不是某个路由的 -queries.ts：
// 活动人员页、项目人员页、议程页里的环节人员弹窗三个消费方都要用，而且
// 它们分别住在三个不相邻的路由目录下，谁 import 谁都是跨路由深路径。
//
// 后端把三层挂在三个前缀上（/api/projectMember、/api/activityMember、
// /api/segmentMember），这里就照着分三组，不做统一封装——三层的筛选条件和
// 返回列本来就不一样，硬抽一层泛型只会把类型糊掉。

// ---------------------------------------------------------------------------
// 项目人员
// ---------------------------------------------------------------------------

export type ProjectMember = ApiData<
  InferResponseType<typeof api.api.projectMember.list.$post>
>["list"][number];

export type ProjectMemberFilters = InferRequestType<
  typeof api.api.projectMember.list.$post
>["json"];

export const projectMemberKeys = {
  all: ["projectMember"] as const,
  list: (filters: ProjectMemberFilters) =>
    [...projectMemberKeys.all, "list", filters] as const,
};

export const projectMemberListQueryOptions = (filters: ProjectMemberFilters) =>
  queryOptions({
    queryKey: projectMemberKeys.list(filters),
    queryFn: () => unwrap(api.api.projectMember.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const addProjectMembers = (
  json: InferRequestType<typeof api.api.projectMember.add.$post>["json"],
) => unwrap(api.api.projectMember.add.$post({ json }));

export const addNewProjectMember = (
  json: InferRequestType<typeof api.api.projectMember.addNew.$post>["json"],
) => unwrap(api.api.projectMember.addNew.$post({ json }));

export const updateProjectMember = (
  json: InferRequestType<typeof api.api.projectMember.update.$post>["json"],
) => unwrap(api.api.projectMember.update.$post({ json }));

export const removeProjectMember = (id: number) =>
  unwrap(api.api.projectMember.remove.$post({ json: { id } }));

// ---------------------------------------------------------------------------
// 活动人员
// ---------------------------------------------------------------------------

export type ActivityMember = ApiData<
  InferResponseType<typeof api.api.activityMember.list.$post>
>["list"][number];

export type ActivityMemberFilters = InferRequestType<
  typeof api.api.activityMember.list.$post
>["json"];

export const activityMemberKeys = {
  all: ["activityMember"] as const,
  list: (filters: ActivityMemberFilters) =>
    [...activityMemberKeys.all, "list", filters] as const,
};

export const activityMemberListQueryOptions = (
  filters: ActivityMemberFilters,
) =>
  queryOptions({
    queryKey: activityMemberKeys.list(filters),
    queryFn: () => unwrap(api.api.activityMember.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const addActivityMembers = (
  json: InferRequestType<typeof api.api.activityMember.add.$post>["json"],
) => unwrap(api.api.activityMember.add.$post({ json }));

export const addNewActivityMember = (
  json: InferRequestType<typeof api.api.activityMember.addNew.$post>["json"],
) => unwrap(api.api.activityMember.addNew.$post({ json }));

export const updateActivityMember = (
  json: InferRequestType<typeof api.api.activityMember.update.$post>["json"],
) => unwrap(api.api.activityMember.update.$post({ json }));

/** 移除前的受影响清单。文案由后端给，前端只负责渲染（BR-DEV-029）。 */
export const getActivityMemberImpact = (id: number) =>
  unwrap(api.api.activityMember.impact.$post({ json: { id } }));

export const removeActivityMember = (id: number, cascade: boolean) =>
  unwrap(api.api.activityMember.remove.$post({ json: { id, cascade } }));

// ---------------------------------------------------------------------------
// 环节人员
// ---------------------------------------------------------------------------

export type SegmentMember = ApiData<
  InferResponseType<typeof api.api.segmentMember.list.$post>
>["list"][number];

export const segmentMemberKeys = {
  all: ["segmentMember"] as const,
  list: (segmentId: number) =>
    [...segmentMemberKeys.all, "list", segmentId] as const,
  conflicts: (activityId: number) =>
    [...segmentMemberKeys.all, "conflicts", activityId] as const,
};

export const segmentMemberListQueryOptions = (segmentId: number) =>
  queryOptions({
    queryKey: segmentMemberKeys.list(segmentId),
    queryFn: () =>
      unwrap(
        api.api.segmentMember.list.$post({
          json: { segmentId, page: 1, pageSize: 100 },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/** 一处冲突 = 一个人 + 两个时间重叠的环节。 */
export type SegmentMemberConflict = ApiData<
  InferResponseType<typeof api.api.segmentMember.conflicts.$post>
>["list"][number];

/**
 * 全活动的人员时间冲突，议程页顶部那条提示的数据源。
 *
 * key 挂在 `segmentMemberKeys.all` 底下，所以环节人员弹窗里那句 invalidate 会
 * 顺带把它刷掉——加人、移人都可能造出或消掉一处冲突。另一半诱因是环节时间
 * 变了，那一侧由议程页在保存后显式失效这个 key（那里失效的是 agendaKeys）。
 */
export const segmentMemberConflictQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: segmentMemberKeys.conflicts(activityId),
    queryFn: () =>
      unwrap(api.api.segmentMember.conflicts.$post({ json: { activityId } })),
  });

export const addSegmentMembers = (
  json: InferRequestType<typeof api.api.segmentMember.add.$post>["json"],
) => unwrap(api.api.segmentMember.add.$post({ json }));

export const addNewSegmentMember = (
  json: InferRequestType<typeof api.api.segmentMember.addNew.$post>["json"],
) => unwrap(api.api.segmentMember.addNew.$post({ json }));

/** 三层"手动录入"共用的主档字段。表单直接用这个类型，不手抄。 */
export type NewMemberFields = InferRequestType<
  typeof api.api.segmentMember.addNew.$post
>["json"]["member"];

export const updateSegmentMember = (
  json: InferRequestType<typeof api.api.segmentMember.update.$post>["json"],
) => unwrap(api.api.segmentMember.update.$post({ json }));

/**
 * 移出环节。`cascade` 为假时，如果这个人在本环节已排座位，服务端会**拒绝**并
 * 回一句点名到座位号的提示——调用方拿这句话再问用户一次，得到确认后带
 * `cascade: true` 重来。跟活动层移除是同一套两步走。
 */
export const removeSegmentMember = (id: number, cascade = false) =>
  unwrap(api.api.segmentMember.remove.$post({ json: { id, cascade } }));

// ---------------------------------------------------------------------------
// 候选人员（选择器的数据源）
// ---------------------------------------------------------------------------

export type CandidateScope = "all" | "project" | "activity";

export type MemberCandidateFilters = InferRequestType<
  typeof api.api.member.candidates.$post
>["json"];

export const memberCandidateQueryOptions = (filters: MemberCandidateFilters) =>
  queryOptions({
    queryKey: ["memberCandidates", filters] as const,
    queryFn: () => unwrap(api.api.member.candidates.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

// ---------------------------------------------------------------------------
// 展示口径
// ---------------------------------------------------------------------------

/**
 * 录入渠道的中文。
 *
 * 注意这是"数据来源"那一列，不是运营手填的「来源」——两者在文档里只差一个字，
 * 在原型 activity-members.html 里还并排摆着。这份映射表只服务前者。
 */
export const RELATION_ORIGIN_LABELS = {
  manual: "后台新增",
  import: "后台导入",
  project_assign: "项目人员分配",
  segment_reference: "引用其他环节",
  registration: "报名审核通过",
  backfill_from_activity: "活动入口补齐",
  backfill_from_segment: "环节入口补齐",
} as const satisfies Record<ActivityMember["originType"], string>;

export const SEGMENT_MEMBER_ROLE_VALUES = [
  "演讲嘉宾",
  "嘉宾",
  "参会人员",
  "工作人员",
] as const;
