import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { RouterContext } from "#/app/providers";
import { routeTree } from "#/routeTree.gen";
import { NotFound } from "#/shared/components/not-found";

export function getRouter(context: RouterContext) {
  return createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
