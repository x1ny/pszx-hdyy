import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppLayout } from "#/app/layout/app-layout.tsx";
import { NotFound } from "#/shared/components/not-found.tsx";
import { sessionQueryOptions } from "#/features/auth/queries";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const session =
      await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user: session.user };
  },
  component: AuthenticatedLayout,
  // 登录后访问不存在的路径时，走这里而不是 router 的 defaultNotFoundComponent，
  // 这样 404 渲染在 AppLayout 的 Outlet 里，侧边栏和顶栏还在。
  notFoundComponent: NotFound,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  return <AppLayout user={user} />;
}
