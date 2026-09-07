import { useRouter } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";

/**
 * 路由 `loader` / `beforeLoad` 抛错时的兜底页（`defaultErrorComponent`）。
 *
 * 没有它的话走的是 TanStack Router 的内置默认：一段英文堆栈。而这里最常见的抛错
 * 来源是 `unwrap()` 把接口的业务失败翻成的 `ApiError`——那些 `message` 本来就是
 * 中文、本来就是写给用户看的，直接显示比堆栈有用得多。
 *
 * 「重试」调 `router.invalidate()` 而不是刷新整页：loader 会重跑，但已经加载好的
 * 其他状态（侧边栏、会话）不用重新拉一遍。
 */
export function RouteError({ error }: { error: Error }) {
  const router = useRouter();

  return (
    <Empty className="min-h-[60vh] flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>页面加载失败</EmptyTitle>
        <EmptyDescription>
          {error.message || "发生了未知错误，请稍后重试。"}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => router.invalidate()}>重试</Button>
      </EmptyContent>
    </Empty>
  );
}
