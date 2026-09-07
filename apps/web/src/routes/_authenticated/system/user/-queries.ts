import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

// ---------------------------------------------------------------------------
// 领域类型全部从接口反推，不手抄（理由同 supplier/-queries.ts）。
//
// 叫 AdminUser 而不是 User：这个模块里同时还有 Better Auth 的会话用户
// （features/auth 那条线），两个 `User` 摆在一起，看代码的人分不清哪个是"我"、
// 哪个是"被管理的账号"。
// ---------------------------------------------------------------------------

export type AdminUser = ApiData<
  InferResponseType<typeof api.api.user.get.$post>
>;
export type UserStatus = AdminUser["status"];

export type UserFilters = InferRequestType<
  typeof api.api.user.list.$post
>["json"];

export type UserFormValues = InferRequestType<
  typeof api.api.user.create.$post
>["json"];

export type RoleOption = ApiData<
  InferResponseType<typeof api.api.role.list.$post>
>[number];

export const userKeys = {
  all: ["adminUser"] as const,
  list: (filters: UserFilters) => [...userKeys.all, "list", filters] as const,
  detail: (id: string) => [...userKeys.all, "detail", id] as const,
};

/** 角色是独立资源，用自己的键——改用户不该把角色下拉一起失效掉。 */
export const roleKeys = {
  all: ["role"] as const,
  list: () => [...roleKeys.all, "list"] as const,
};

export const userListQueryOptions = (filters: UserFilters) =>
  queryOptions({
    queryKey: userKeys.list(filters),
    queryFn: () => unwrap(api.api.user.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const userDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: userKeys.detail(id),
    queryFn: () => unwrap(api.api.user.get.$post({ json: { id } })),
  });

/**
 * 角色下拉的数据源。**本次只有一条内置的"超级管理员"**——角色管理是下一个 PR，
 * 在那之前这个下拉里只有它。见 docs/user-management-design.md。
 */
export const roleListQueryOptions = () =>
  queryOptions({
    queryKey: roleKeys.list(),
    queryFn: () => unwrap(api.api.role.list.$post({ json: {} })),
    // 角色几乎不变，别每次开表单都重新请求。
    staleTime: 5 * 60 * 1000,
  });

// 变更操作只导出裸函数，useMutation 留在页面里写（同 supplier）。

export const createUser = (values: UserFormValues) =>
  unwrap(api.api.user.create.$post({ json: values }));

export const updateUser = (
  values: Omit<UserFormValues, "username" | "password"> & { id: string },
) => unwrap(api.api.user.update.$post({ json: values }));

export const deleteUser = (id: string) =>
  unwrap(api.api.user.delete.$post({ json: { id } }));

export const setUserStatus = (id: string, status: UserStatus) =>
  unwrap(api.api.user.setStatus.$post({ json: { id, status } }));

/** 管理员重置**他人**密码，不需要原密码。 */
export const resetUserPassword = (id: string, password: string) =>
  unwrap(api.api.user.resetPassword.$post({ json: { id, password } }));

// 「改自己的密码」不在这里 —— 它的入口是右上角头像菜单，属于
// features/auth/change-password-dialog.tsx。放这儿的话，那个组件就得跨路由
// import 本文件（`-` 目录），而那是 AGENTS.md 明令禁止的方向。
