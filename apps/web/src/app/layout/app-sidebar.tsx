import { Link } from "@tanstack/react-router";
import { LayoutGrid } from "lucide-react";
import { NavMain } from "#/app/layout/nav-main.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "#/shared/components/ui/sidebar.tsx";

const sidebarTheme = {
  "--sidebar": "#f7f8fa",
  "--sidebar-foreground": "#3c4149",
  "--sidebar-primary": "#2b4acb",
  "--sidebar-primary-foreground": "#ffffff",
  "--sidebar-accent": "#eaf0ff",
  "--sidebar-accent-foreground": "#2b4acb",
  "--sidebar-border": "#eceef1",
  "--sidebar-ring": "#2b4acb",
} as React.CSSProperties;

export function AppSidebar() {
  return (
    <Sidebar
      collapsible="icon"
      className="text-sidebar-foreground"
      style={sidebarTheme}
    >
      <SidebarHeader className="p-0">
        <SidebarMenu className="gap-0">
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="活动运营平台"
              className="h-[58px] rounded-none px-[18px]"
              render={<Link to="/dashboard" />}
            >
              <div className="flex size-[26px] shrink-0 items-center justify-center rounded-[6px] bg-sidebar-primary text-sidebar-primary-foreground">
                <LayoutGrid className="size-3.5" />
              </div>
              <span className="truncate text-[15px] font-semibold">
                活动运营平台
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <NavMain />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
