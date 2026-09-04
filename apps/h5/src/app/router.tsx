import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { RouterContext } from "#/app/providers";
import { routeTree } from "#/routeTree.gen";
import { PageMessage } from "#/shared/components/page-message";

export function getRouter(context: RouterContext) {
  return createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // 没有这两个的话走的是 TanStack Router 内置的默认值 —— 一段英文裸文案，
    // 出现在公众端嘉宾眼前。单个路由仍可以用自己的 notFoundComponent /
    // errorComponent 覆盖成更贴合那一页的话术。
    defaultNotFoundComponent: () => (
      <PageMessage
        title="页面不存在"
        hint="请通过主办方提供的链接或二维码进入"
      />
    ),
    defaultErrorComponent: () => (
      <PageMessage
        title="页面加载失败"
        hint="请检查网络后重新打开，或联系主办方"
      />
    ),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
