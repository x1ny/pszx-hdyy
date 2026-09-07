import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppLayout } from "#/app/layout/app-layout.tsx";
import { sessionQueryOptions } from "#/features/auth/queries";
import { permissionForRouteId } from "#/features/auth/route-permissions";
import { Forbidden } from "#/shared/components/forbidden.tsx";
import { NotFound } from "#/shared/components/not-found.tsx";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location, matches }) => {
    const session =
      await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }

    // 取最深的那个匹配路由：活动详情要按 `.../activity/...` 判成「活动管理」，
    // 只看 `_authenticated` 自己的 id 是分不出来的。
    const deepestRouteId = matches.at(-1)?.routeId ?? "";
    const required = permissionForRouteId(deepestRouteId);

    return {
      user: session.user,
      permissions: session.permissions,
      // 不 throw、不 redirect，交给组件渲染 <Forbidden/>——静默跳走会把权限问题
      // 伪装成页面故障，理由写在 shared/components/forbidden.tsx。
      forbidden: required !== null && !session.permissions.includes(required),
    };
  },
  component: AuthenticatedLayout,
  // 登录后访问不存在的路径时，走这里而不是 router 的 defaultNotFoundComponent，
  // 这样 404 渲染在 AppLayout 的 Outlet 里，侧边栏和顶栏还在。
  notFoundComponent: NotFound,
});

function AuthenticatedLayout() {
  const { user, permissions, forbidden } = Route.useRouteContext();
  return (
    <AppLayout user={user} permissions={permissions}>
      {forbidden ? <Forbidden /> : undefined}
    </AppLayout>
  );
}
