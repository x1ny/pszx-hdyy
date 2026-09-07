import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { RouterContext } from "#/app/providers";
import { routeTree } from "#/routeTree.gen";
import { NotFound } from "#/shared/components/not-found";
import { RouteError } from "#/shared/components/route-error";

export function getRouter(context: RouterContext) {
  return createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
    // loader / beforeLoad 抛错的兜底。默认是一段英文堆栈，而这里最常见的抛错是
    // unwrap() 翻出来的 ApiError——那些 message 本来就是写给用户看的中文。
    defaultErrorComponent: RouteError,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
