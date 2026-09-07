import { PERMISSION_KEYS } from "@repo/server/permissions";
import { describe, expect, it } from "vitest";
import { navMain } from "#/app/nav.ts";
import {
  mappedPermissions,
  permissionForRouteId,
} from "#/features/auth/route-permissions";

/**
 * 盯着菜单、权限点清单、路由守卫三者的**覆盖面**。
 *
 * 权限点是"一个菜单项 = 一个权限点"，所以三处必须一一对应：
 *   - `shared/permissions.ts`（服务端，权威清单）
 *   - `app/nav.ts`（菜单项，同时是角色管理页复选框网格的数据源）
 *   - `features/auth/route-permissions.ts`（前端路由守卫）
 *
 * 缺一处都不会报错，只会静默少一块：清单里多一个点而菜单里没有 → 角色页勾了没用；
 * 菜单里有而守卫表里没有 → 那个页面谁都进得去（服务端仍然拦得住，但用户会撞一
 * 屏 403）。所以用一条测试把三者钉在一起。
 */
describe("菜单与权限点一一对应", () => {
  const menuPermissions = navMain.flatMap((item) =>
    "children" in item
      ? item.children.map((child) => child.permission)
      : item.permission
        ? [item.permission]
        : [],
  );

  it.each(PERMISSION_KEYS)("权限点 %s 在菜单里有对应项", (key) => {
    expect(
      menuPermissions,
      `权限点 ${key} 没有对应的菜单项。角色管理页按 navMain 渲染复选框，` +
        `所以缺了它的话运营在界面上勾不到这个点——要么给 app/nav.ts 补一项，` +
        `要么把它从服务端的 PERMISSION_KEYS 里删掉。`,
    ).toContain(key);
  });

  it("菜单里没有重复的权限点", () => {
    // 同一个点出现在两个菜单项上，角色页会渲染两个联动的复选框。
    expect(new Set(menuPermissions).size).toBe(menuPermissions.length);
  });

  it("工作台不带权限点（它是登录落地页）", () => {
    const dashboard = navMain.find((item) => item.title === "工作台");
    expect(dashboard).toBeDefined();
    expect(dashboard && "children" in dashboard).toBe(false);
    // 没有任何权限点的用户也得有地方可去，否则登录后无处落脚。
    expect(
      dashboard && "permission" in dashboard ? dashboard.permission : undefined,
    ).toBeUndefined();
  });

  it.each(PERMISSION_KEYS)("权限点 %s 在路由守卫表里有对应路由", (key) => {
    expect(
      mappedPermissions,
      `权限点 ${key} 没有出现在 features/auth/route-permissions.ts 里。` +
        `后果是那个页面前端不设防：接口会返回 403，但用户看到的是一屏报错，` +
        `而不是"没有权限"。`,
    ).toContain(key);
  });
});

describe("路由守卫的前缀匹配", () => {
  it("活动详情归「活动管理」，尽管它的 URL 挂在项目下面", () => {
    // 这是整张表存在的理由：URL 结构和权限分组对不上。
    expect(
      permissionForRouteId(
        "/_authenticated/project/$projectId_/activity/$activityId/seating",
      ),
    ).toBe("activity");
    expect(permissionForRouteId("/_authenticated/project/list")).toBe(
      "project",
    );
  });

  it("工作台和未登记的路由都放行", () => {
    expect(permissionForRouteId("/_authenticated/dashboard")).toBeNull();
    expect(permissionForRouteId("/_authenticated/$")).toBeNull();
  });

  it("系统管理的两项分得开", () => {
    expect(permissionForRouteId("/_authenticated/system/user/")).toBe(
      "systemUser",
    );
    expect(permissionForRouteId("/_authenticated/system/role/")).toBe(
      "systemRole",
    );
  });
});
