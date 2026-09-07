import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// 领域类型全部从接口反推，不手抄（同 supplier / system-user）。
export type Role = ApiData<
  InferResponseType<typeof api.api.role.page.$post>
>["list"][number];

export type RoleFilters = InferRequestType<
  typeof api.api.role.page.$post
>["json"];

export type RoleFormValues = InferRequestType<
  typeof api.api.role.create.$post
>["json"];

/**
 * 和 `system/user/-queries.ts` 里那个 `roleKeys` **刻意不共用**。
 *
 * 那边的 `["role","list"]` 是用户表单的角色下拉（不分页、只有 id/name）；这边是
 * 角色管理页自己的分页列表。共用一个前缀的话，这里删一个角色会把那边的下拉一起
 * 失效——那其实是想要的，但反过来那边开一次表单也会让这里整页重拉，白刷。
 */
export const roleAdminKeys = {
  all: ["adminRole"] as const,
  list: (filters: RoleFilters) =>
    [...roleAdminKeys.all, "list", filters] as const,
};

export const roleListQueryOptions = (filters: RoleFilters) =>
  queryOptions({
    queryKey: roleAdminKeys.list(filters),
    queryFn: () => unwrap(api.api.role.page.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

// 变更操作只导出裸函数，useMutation 留在页面里写（同 supplier）。

export const createRole = (values: RoleFormValues) =>
  unwrap(api.api.role.create.$post({ json: values }));

export const updateRole = (values: RoleFormValues & { id: number }) =>
  unwrap(api.api.role.update.$post({ json: values }));

export const deleteRole = (id: number) =>
  unwrap(api.api.role.delete.$post({ json: { id } }));
