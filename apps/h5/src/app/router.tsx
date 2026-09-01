import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { RouterContext } from "#/app/providers";
import { routeTree } from "#/routeTree.gen";

export function getRouter(context: RouterContext) {
  return createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
