import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import type { MemberStatus } from "#/features/member/queries";
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

export type OrganizationListItem = ApiData<
  InferResponseType<typeof api.api.organization.list.$post>
>["list"][number];

export type OrganizationDetail = ApiData<
  InferResponseType<typeof api.api.organization.get.$post>
>;

export type OrganizationOption = ApiData<
  InferResponseType<typeof api.api.organization.options.$post>
>[number];

export type OrganizationFilters = InferRequestType<
  typeof api.api.organization.list.$post
>["json"];

export type OrganizationFormValues = InferRequestType<
  typeof api.api.organization.create.$post
>["json"];

export type OrganizationUpdateValues = InferRequestType<
  typeof api.api.organization.update.$post
>["json"];

export const organizationKeys = {
  all: ["organization"] as const,
  list: (filters: OrganizationFilters) =>
    [...organizationKeys.all, "list", filters] as const,
  detail: (id: number) => [...organizationKeys.all, "detail", id] as const,
  options: () => [...organizationKeys.all, "options"] as const,
};

export const organizationListQueryOptions = (filters: OrganizationFilters) =>
  queryOptions({
    queryKey: organizationKeys.list(filters),
    queryFn: () => unwrap(api.api.organization.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const organizationDetailQueryOptions = (id: number) =>
  queryOptions({
    queryKey: organizationKeys.detail(id),
    queryFn: () => unwrap(api.api.organization.get.$post({ json: { id } })),
  });

export const organizationOptionsQueryOptions = () =>
  queryOptions({
    queryKey: organizationKeys.options(),
    queryFn: () => unwrap(api.api.organization.options.$post()),
  });

export const createOrganization = (values: OrganizationFormValues) =>
  unwrap(api.api.organization.create.$post({ json: values }));

export const updateOrganization = (values: OrganizationUpdateValues) =>
  unwrap(api.api.organization.update.$post({ json: values }));

export const deleteOrganization = (id: number) =>
  unwrap(api.api.organization.delete.$post({ json: { id } }));

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
