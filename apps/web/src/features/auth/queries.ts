import type { PermissionKey } from "@repo/server/permissions";
import { queryOptions } from "@tanstack/react-query";
import { authClient } from "#/features/auth/auth-client";
import { api, unwrap } from "#/shared/lib/api";

export const sessionQueryKey = ["session"] as const;

/**
 * 会话 + 当前用户的权限点，**共用一个 query key**。
 *
 * 权限点单独开一个 key 也能跑，但那会让 AGENTS.md 里记着的那个坑翻倍：登录/登出
 * 后必须 `removeQueries({ queryKey: sessionQueryKey })`，因为守卫用的
 * `ensureQueryData` **即使数据已过期也会先返回缓存**。两个 key 就是两处都要记得
 * 删，漏一个的表现是"登录成功但菜单还是上一个人的"。
 *
 * 代价是首屏两次串行往返。可以接受：`staleTime` 是 5 分钟，这条路径只在应用加载
 * 和会话过期时走。
 *
 * 权限点为什么不跟 Better Auth 的 `getSession()` 一起回来：那需要 `customSession`
 * 插件，而插件必须前后端成对出现、漏了不报类型错（`auth-client.ts` 的注释专门
 * 警告过这个坑）。走自己的接口则整个待在项目已有的约定里（ApiResult + hc 推导），
 * 而且服务端零额外查询——权限点是顺着 sessionMiddleware 已有的那次查询回来的。
 */
export const sessionQueryOptions = queryOptions({
  queryKey: sessionQueryKey,
  queryFn: async () => {
    const { data } = await authClient.getSession();
    if (!data) return null;

    const permissions = await unwrap(api.api.permission.mine.$post());
    return { ...data, permissions: permissions as PermissionKey[] };
  },
  staleTime: 5 * 60 * 1000,
});
