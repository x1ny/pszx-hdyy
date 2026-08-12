import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppLayout } from "#/components/layout/app-layout.tsx";
import { sessionQueryOptions } from "#/lib/session";

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
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  return <AppLayout user={user} />;
}
