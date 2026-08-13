import type { LinkProps } from "@tanstack/react-router";
import {
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  MailIcon,
  Settings,
  Truck,
  UsersRound,
} from "lucide-react";

/** 侧边栏叶子项：一定对应一条真实路由。 */
export type NavLeaf = {
  title: string;
  to: NonNullable<LinkProps["to"]>;
};

/**
 * 侧边栏一级项。给了 `children` 就渲染成可折叠分组，
 * 否则渲染成直接跳转的单项（此时 `to` 必填）。
 */
export type NavItem =
  | { title: string; icon: LucideIcon; to: NonNullable<LinkProps["to"]> }
  | { title: string; icon: LucideIcon; children: NavLeaf[] };

/**
 * 菜单是纯前端静态配置，只负责 UI。
 * 真正的权限校验必须在服务端每个接口里各自完成——前端菜单不是安全边界。
 */
export const navMain: NavItem[] = [
  { title: "工作台", icon: LayoutDashboard, to: "/dashboard" },
  {
    title: "项目管理",
    icon: FolderKanban,
    children: [{ title: "项目列表", to: "/project/list" }],
  },
  { title: "供应商管理", icon: Truck, to: "/supplier" },
  { title: "人员管理", icon: UsersRound, to: "/member" },
  {
    title: "邀请函管理",
    icon: MailIcon,
    children: [
      { title: "模板管理", to: "/invitation/template" },
      { title: "生成邀请函", to: "/invitation/generate" },
      { title: "生成记录", to: "/invitation/batch" },
    ],
  },
  {
    title: "系统管理",
    icon: Settings,
    children: [
      { title: "用户管理", to: "/system/user" },
      { title: "角色管理", to: "/system/role" },
    ],
  },
];
