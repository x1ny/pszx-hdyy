import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { RouterContext } from "#/app/providers";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return <Outlet />;
}
