import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShieldXIcon } from "lucide-react";
import { AppLayout } from "#/app/layout/app-layout.tsx";
import { firstAccessibleNavPath } from "#/app/nav.ts";
import { sessionQueryOptions } from "#/features/auth/queries";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context, location }) => {
    const session =
      await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }

    const firstPath = firstAccessibleNavPath(session.permissions);
    if (firstPath) throw redirect({ to: firstPath });

    return { user: session.user, permissions: session.permissions };
  },
  component: NoAccessiblePage,
});

function NoAccessiblePage() {
  const { user, permissions } = Route.useRouteContext();

  return (
    <AppLayout user={user} permissions={permissions}>
      <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-3 text-center">
        <ShieldXIcon className="size-10 text-muted-foreground" />
        <h1 className="font-semibold text-xl tracking-tight">暂无可访问页面</h1>
        <p className="text-sm text-muted-foreground">
          请联系系统管理员为你的角色分配菜单权限。
        </p>
      </div>
    </AppLayout>
  );
}
