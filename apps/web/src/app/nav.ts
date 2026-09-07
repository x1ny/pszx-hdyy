import type { PermissionKey } from "@repo/server/permissions";
import type { LinkProps } from "@tanstack/react-router";
import {
  Building2,
  CalendarDays,
  Folder,
  LayoutGrid,
  type LucideIcon,
  Mail,
  MapPin,
  Settings,
  UsersRound,
} from "lucide-react";

/**
 * 侧边栏叶子项：一定对应一条真实路由。
 *
 * `permission` **必填**。权限点和菜单项是一一对应的（一个菜单项 = 一个权限点，
 * 能进就能改），漏一个就意味着那个页面对谁都可见；类型咬死之后，新增菜单项时
 * TypeScript 直接要求填，而 `PermissionKey` 来自服务端，拼错也编译不过。
 */
export type NavLeaf = {
  title: string;
  to: NonNullable<LinkProps["to"]>;
  permission: PermissionKey;
};

/**
 * 侧边栏一级项。给了 `children` 就渲染成可折叠分组，
 * 否则渲染成直接跳转的单项（此时 `to` 必填）。
 *
 * 单项的 `permission` 是可选的，**只为「工作台」留的口子**：它是登录后的落地页，
 * 一个权限点都没有的用户也得有地方可去。除它之外的每个单项都要填。
 */
export type NavItem =
  | {
      title: string;
      icon: LucideIcon;
      to: NonNullable<LinkProps["to"]>;
      permission?: PermissionKey;
    }
  | { title: string; icon: LucideIcon; children: NavLeaf[] };

/**
 * 菜单是纯前端静态配置，只负责 UI。
 * 真正的权限校验必须在服务端每个接口里各自完成——前端菜单不是安全边界。
 *
 * **这份数组同时是角色管理页复选框网格的数据源**（`system/role` 直接按它渲染），
 * 所以新增一个带 `permission` 的菜单项，角色页会自动多出一个可勾选项，不会出现
 * "页面上线了但权限点忘了配"。`nav.test.ts` 断言它覆盖了全部 `PermissionKey`。
 */
export const navMain: NavItem[] = [
  { title: "工作台", icon: LayoutGrid, to: "/dashboard" },
  {
    title: "项目管理",
    icon: Folder,
    children: [
      { title: "项目列表", to: "/project/list", permission: "project" },
    ],
  },
  /**
   * 活动管理是一级菜单，同时项目详情下的「活动列表」标签页原样保留——同一份
   * 数据的两个入口，对应两种真实的工作方式：筹备阶段按项目看，临场时按活动
   * 名找（那时没人记得它挂在哪个项目下）。
   *
   * 它不套折叠分组，判据和下面场地/邀请函模板那两条一样：只有一项。活动详情
   * 的各个配置页仍然只能从活动进，不进全局菜单——它们都需要活动上下文。
   */
  {
    title: "活动管理",
    icon: CalendarDays,
    to: "/activity",
    permission: "activity",
  },
  {
    title: "供应商管理",
    icon: Building2,
    to: "/supplier",
    permission: "supplier",
  },
  { title: "人员管理", icon: UsersRound, to: "/member", permission: "member" },
  /**
   * 场地是**唯一**进全局菜单的排位相关页面，而且不套折叠分组。
   *
   * 原型建了一个「排位管理」一级菜单，下挂场地库、排位方案列表、排位确认三项。
   * 那个信息架构不采纳：后两项都必须带活动上下文才能工作，放全局菜单里，用户的
   * 第一步永远是「先选一个活动」。它们进活动详情的标签页——判据和邀请函模块
   * 一样（模板留全局、生成和记录进活动详情）。理由记在
   * docs/场地排位底层设计.md §2.1。
   */
  { title: "场地管理", icon: MapPin, to: "/venue", permission: "venue" },
  /**
   * 只剩模板一项，所以不套折叠分组。
   *
   * 生成邀请函和生成记录都挪进了活动详情的「邀请函」标签页——它们全都需要活动
   * 上下文才能工作：选人只能从**本活动的活动人员**里选，一份邀请函的唯一性也是
   * 按 (活动, 人员) 定的。放在全局菜单里，第一步永远是「先选一个活动」。
   *
   * 模板留在全局：三份真实模板是按发函主体（联盟/商会/专班）分的，不按活动分。
   */
  {
    title: "邀请函模板",
    icon: Mail,
    to: "/invitation/template",
    permission: "invitationTemplate",
  },
  {
    title: "系统管理",
    icon: Settings,
    children: [
      { title: "用户管理", to: "/system/user", permission: "systemUser" },
      { title: "角色管理", to: "/system/role", permission: "systemRole" },
    ],
  },
];
