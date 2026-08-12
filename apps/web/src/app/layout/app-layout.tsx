import { Outlet } from "@tanstack/react-router";
import { AppSidebar } from "#/app/layout/app-sidebar.tsx";
import { NavUser } from "#/app/layout/nav-user.tsx";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "#/shared/components/ui/sidebar.tsx";

export function AppLayout({ user }: { user: { name: string; email: string } }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/*
         * 高度必须手动跟 SidebarHeader 对齐，组件不会帮你算：
         *   展开态 = p-2 + size="lg" 按钮(h-12) + p-2 = 64px → h-16
         *   收起态 = p-2 + 按钮被 group-data-[collapsible=icon]:size-8! 压成 32 + p-2
         *            = 48px → h-12
         * 少写下面那个 group-has-* 变体，收起侧边栏时顶栏下边框就会比侧边栏
         * logo 区的底边低 16px。
         */}
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4 transition-[height] duration-200 ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <SidebarTrigger />
          <div className="ml-auto">
            <NavUser name={user.name} email={user.email} />
          </div>
        </header>
        <div className="flex flex-1 flex-col p-6">
          <Outlet />
        </div>
        <footer className="shrink-0 border-t px-6 py-4 text-center text-sm text-muted-foreground">
          活动运营平台 © {new Date().getFullYear()}
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
