import { Link } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { buttonVariants } from "#/components/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/components/ui/empty.tsx";

/**
 * 同时用作 _authenticated 的 notFoundComponent（渲染在 AppLayout 的 Outlet
 * 里，带侧边栏）和 router 的 defaultNotFoundComponent（未登录时的兜底，独立
 * 一整页）。min-h-[60vh] 是给独立场景兜底的高度，嵌进布局时会被 flex-1 撑满。
 */
export function NotFound() {
  return (
    <Empty className="min-h-[60vh] flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>页面不存在</EmptyTitle>
        <EmptyDescription>链接可能已失效，或者页面已被移动。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {/*
         * 不用 <Button render={<Link/>}>：Base UI 的 Button 默认假设 render
         * 出来的是原生 <button>（nativeButton=true），换成 <a> 会报警告。
         * 官方建议链接直接用 buttonVariants() 上色，不套 Button 语义。
         */}
        <Link to="/dashboard" className={buttonVariants()}>
          返回工作台
        </Link>
      </EmptyContent>
    </Empty>
  );
}
