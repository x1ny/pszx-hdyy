import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { type NavItem, navMain } from "#/app/nav.ts";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/shared/components/ui/collapsible.tsx";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "#/shared/components/ui/sidebar.tsx";

export function NavMain() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <SidebarGroup className="p-[6px_10px]">
      <SidebarMenu className="gap-0">
        {navMain.map((item) =>
          "children" in item ? (
            <NavGroup key={item.title} item={item} pathname={pathname} />
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={
                  pathname === item.to ||
                  pathname.startsWith(`${item.to}/`) ||
                  (item.title === "活动管理" && pathname.includes("/activity/"))
                }
                className="h-[39px] gap-2.5 rounded-md px-3 text-[14px]"
                render={<Link to={item.to} />}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function NavGroup({
  item,
  pathname,
}: {
  item: Extract<NavItem, { children: unknown }>;
  pathname: string;
}) {
  const hasActiveChild = item.children.some(
    (child) => pathname === child.to || pathname.startsWith(`${child.to}/`),
  );
  // 参考界面默认展开「项目管理」，项目详情页也保留这个入口；它们不应把
  // 父菜单染成 active。用户手动收起后，仍由 Collapsible 自己保留这个选择。
  const isProjectMenu = item.title === "项目管理";
  const [open, setOpen] = useState(hasActiveChild || isProjectMenu);

  // 必须受控：hasActiveChild 会随路由变化，而 Base UI 的非受控 Collapsible 在
  // 初始化后再改 defaultOpen 会告警且不生效。这里只负责"路由进到本组就展开"，
  // 展开后要不要收起交给用户，不跟着路由强行合上。
  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={
          <SidebarMenuButton
            tooltip={item.title}
            isActive={hasActiveChild}
            className="h-[39px] gap-2.5 rounded-md px-3 text-[14px]"
          />
        }
      >
        <item.icon />
        <span>{item.title}</span>
        <ChevronRight className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub className="mx-0 mb-0.5 translate-x-0 gap-0 border-0 px-0 py-0.5">
          {item.children.map((child) => (
            <SidebarMenuSubItem key={child.to}>
              <SidebarMenuSubButton
                isActive={pathname === child.to}
                className="h-[38px] translate-x-0 rounded-md px-3 pl-[34px] text-[13.5px]"
                render={<Link to={child.to} />}
              >
                <span>{child.title}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}
