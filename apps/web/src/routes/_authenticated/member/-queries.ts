import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

export type Member = ApiData<
  InferResponseType<typeof api.api.getMember.$post>
>;
export type MemberStatus = Member["status"];

export type MemberFilters = InferRequestType<
  typeof api.api.listMembers.$post
>["json"];

export type MemberFormValues = InferRequestType<
  typeof api.api.createMember.$post
>["json"];

export const memberKeys = {
  all: ["member"] as const,
  list: (filters: MemberFilters) => [...memberKeys.all, "list", filters] as const,
};

export const memberListQueryOptions = (filters: MemberFilters) =>
  queryOptions({
    queryKey: memberKeys.list(filters),
    queryFn: () => unwrap(api.api.listMembers.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const createMember = (values: MemberFormValues) =>
  unwrap(api.api.createMember.$post({ json: values }));

export const updateMember = (values: MemberFormValues & { id: number }) =>
  unwrap(api.api.updateMember.$post({ json: values }));

export const deleteMember = (id: number) =>
  unwrap(api.api.deleteMember.$post({ json: { id } }));

export const setMemberStatus = (id: number, status: MemberStatus) =>
  unwrap(api.api.setMemberStatus.$post({ json: { id, status } }));
