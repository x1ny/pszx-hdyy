import type { PermissionKey } from "@repo/server/permissions";

/**
 * 路由 → 权限点。服务端 `modules/auth/permission-map.ts` 的**前端镜像**。
 *
 * ## 为什么是一张表，不是每个路由自己写 beforeLoad
 *
 * 逐路由手写守卫的漏写方式和服务端一模一样：静默放行。区别只在于后果——服务端
 * 漏挂是安全漏洞，前端漏挂只是"页面渲染出来了但接口全 403"。既然失败模式相同，
 * 防法也保持一致：一处映射 + 一个测试断言菜单里的每一项都被覆盖。
 *
 * ## 为什么按路由 id 而不是 URL 路径
 *
 * 因为 URL 结构和权限分组**对不上**：活动详情挂在 `/project/` 下面
 * （`/project/1/activity/1/agenda`），按裸路径前缀判断会把它算成「项目管理」。
 * 路由 id 保留了文件结构（`/_authenticated/project/$projectId_/activity/...`），
 * 拿它做最长前缀匹配才分得开这两者。
 *
 * ## 它不是安全边界
 *
 * 用户绕过界面直接打 `/api/*` 即可。这张表只负责"别让人看见点不动的东西"，
 * 真正的闸门在服务端每条路由上。
 */
const PERMISSION_BY_ROUTE_ID: Record<string, PermissionKey> = {
  // 活动详情在 URL 上是项目的子路径，但归「活动管理」。必须排在
  // `/_authenticated/project` 前面被匹配到——靠的是下面的最长前缀优先。
  "/_authenticated/project/$projectId_/activity": "activity",
  "/_authenticated/project": "project",
  "/_authenticated/activity": "activity",
  "/_authenticated/supplier": "supplier",
  "/_authenticated/member": "member",
  "/_authenticated/venue": "venue",
  "/_authenticated/invitation/template": "invitationTemplate",
  "/_authenticated/system/user": "systemUser",
  "/_authenticated/system/role": "systemRole",
};

const sortedRouteIds = Object.keys(PERMISSION_BY_ROUTE_ID).sort(
  (a, b) => b.length - a.length,
);

/**
 * 这条路由要哪个权限点。返回 `null` = 登录即可进（工作台、404 兜底页）。
 *
 * 传进来的应该是**最深的那个匹配路由的 id**，见 `_authenticated.tsx`。
 */
export const permissionForRouteId = (
  routeId: string,
): PermissionKey | null => {
  for (const prefix of sortedRouteIds) {
    if (routeId === prefix || routeId.startsWith(`${prefix}/`)) {
      return PERMISSION_BY_ROUTE_ID[prefix] ?? null;
    }
  }
  return null;
};

/** 测试用：断言菜单里每个权限点都在这张表里出现过。 */
export const mappedPermissions = new Set<PermissionKey>(
  Object.values(PERMISSION_BY_ROUTE_ID),
);
