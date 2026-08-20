import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { memberKeys, type MemberStatus } from "#/features/member/queries";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// 类型和"浏览列表"能力提到 features/member/queries.ts 了（邀请函生成页选
// 邀请对象也要用），这里只重新导出、加上仅本页面用的变更操作。
// `export type {...} from` 只负责转发给别人 import，不会把名字带进本文件
// 自己的作用域——下面这几个变更函数要用到 MemberStatus，得再单独 import 一次。
export type {
  Member,
  MemberFilters,
  MemberStatus,
} from "#/features/member/queries";
export { memberKeys, memberListQueryOptions } from "#/features/member/queries";

export type MemberFormValues = InferRequestType<
  typeof api.api.member.create.$post
>["json"];

export const createMember = (values: MemberFormValues) =>
  unwrap(api.api.member.create.$post({ json: values }));

export const updateMember = (values: MemberFormValues & { id: number }) =>
  unwrap(api.api.member.update.$post({ json: values }));

export const deleteMember = (id: number) =>
  unwrap(api.api.member.delete.$post({ json: { id } }));

export const setMemberStatus = (id: number, status: MemberStatus) =>
  unwrap(api.api.member.setStatus.$post({ json: { id, status } }));

/** 详情弹窗里的"参与信息"：按项目分组的活动参与列表。 */
export type MemberParticipation = ApiData<
  InferResponseType<typeof api.api.member.participation.$post>
>["list"][number];

export const memberParticipationQueryOptions = (id: number) =>
  queryOptions({
    queryKey: [...memberKeys.all, "participation", id] as const,
    queryFn: () => unwrap(api.api.member.participation.$post({ json: { id } })),
  });
