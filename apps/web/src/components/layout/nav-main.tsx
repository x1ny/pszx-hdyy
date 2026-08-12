import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible.tsx";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "#/components/ui/sidebar.tsx";
import { type NavItem, navMain } from "#/config/nav.ts";

export function NavMain() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <SidebarGroup>
      <SidebarMenu>
        {navMain.map((item) =>
          "children" in item ? (
            <NavGroup key={item.title} item={item} pathname={pathname} />
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={pathname === item.to}
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
  const hasActiveChild = item.children.some((child) => child.to === pathname);
  const [open, setOpen] = useState(hasActiveChild);

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
          <SidebarMenuButton tooltip={item.title} isActive={hasActiveChild} />
        }
      >
        <item.icon />
        <span>{item.title}</span>
        <ChevronRight className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {item.children.map((child) => (
            <SidebarMenuSubItem key={child.to}>
              <SidebarMenuSubButton
                isActive={pathname === child.to}
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
