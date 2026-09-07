import { Link } from "@tanstack/react-router";
import { ShieldXIcon } from "lucide-react";
import { buttonVariants } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";

/**
 * 没有该页面权限时渲染它，**而不是静默重定向到工作台**。
 *
 * 这个系统里页面链接是会在同事之间转发的（活动详情、排位方案都带 id）。悄悄跳走
 * 会把一次权限配置问题伪装成一次页面故障——用户看到的是"我点了没反应"，然后来问
 * 的是"系统坏了"。说清楚"没有权限、找管理员"，那句话本身就是解决路径。
 *
 * 形态照抄 not-found.tsx；同样既能嵌进 AppLayout 的 Outlet（带侧边栏），
 * 也能独立成一整页。
 */
export function Forbidden() {
  return (
    <Empty className="min-h-[60vh] flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldXIcon />
        </EmptyMedia>
        <EmptyTitle>没有访问权限</EmptyTitle>
        <EmptyDescription>
          你的角色不包含该功能，如需使用请联系管理员分配权限。
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {/* 同 not-found.tsx：链接直接用 buttonVariants()，不套 Button 语义。 */}
        <Link to="/dashboard" className={buttonVariants()}>
          返回工作台
        </Link>
      </EmptyContent>
    </Empty>
  );
}
