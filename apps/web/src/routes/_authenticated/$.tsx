import { createFileRoute } from "@tanstack/react-router";
import { NotFound } from "#/shared/components/not-found.tsx";

// 兜底捕获：让登录后访问任意不存在的路径都落进这个真实叶子路由，而不是靠
// notFoundComponent 的 fuzzy 兜底——后者测出来对完全不沾边的路径不生效
// （只会掉回 router 级别、脱离 AppLayout 的 defaultNotFoundComponent）。
export const Route = createFileRoute("/_authenticated/$")({
  component: NotFound,
});
