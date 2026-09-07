import { describe, expect, test } from "bun:test";
import { routes as app } from "../../index";
import { PERMISSION_KEYS } from "../../shared/permissions";
import {
  isMapped,
  PERMISSION_BY_PREFIX,
  resolvePermission,
  UNGATED_PATHS,
  UNGATED_PREFIXES,
} from "./permission-map";

/**
 * 盯着权限闸门的**覆盖面**，而不是某个函数算得对不对。
 *
 * 防的是这个失败模式：新增一个模块、忘了在 `permission-map.ts` 里登记它的前缀。
 * `requireUser` 漏挂会立刻炸（handler 里 `authedUser` 是空的），而闸门漏挂是
 * **静默全开**——所有角色都能调那个模块的全部接口，没有报错、没有类型错误。
 * 这类"改坏了也不报错"的约束只能靠一条测试盯着，同 signup-closed.test.ts。
 *
 * 不连库：只读 `app.routes` 这张注册表，不发请求。
 */
describe("权限映射表覆盖全部已注册路由", () => {
  // Better Auth 自己的路由和开发后门都注册在闸门之前，不归它管。
  const businessPaths = [
    ...new Set(
      app.routes
        // method "ALL" 的条目是 `.use()` 注册的中间件（含闸门自己的 /api/*），
        // 不是接口。只有真正的 handler 需要被闸门覆盖。
        .filter((route) => route.method !== "ALL")
        .map((route) => route.path)
        .filter(
          (path) =>
            path.startsWith("/api/") &&
            !path.startsWith("/api/auth/") &&
            !path.startsWith("/api/dev/"),
        ),
    ),
  ];

  test("能取到路由清单（取不到的话下面的断言会全部空转）", () => {
    expect(businessPaths.length).toBeGreaterThan(100);
  });

  test.each(businessPaths)("%s 已登记", (path) => {
    // 失败时这条信息就是修法本身——读到它的人（或 agent）不用回头翻设计文档。
    const hint =
      `路径 ${path} 没有在 modules/auth/permission-map.ts 里登记。三选一：\n` +
      `  1. 它属于某个菜单项 → 在 PERMISSION_BY_PREFIX 里给它的前缀写一个权限点；\n` +
      `  2. 整个模块都不该受权限点管（公众端、静态文件）→ 加进 UNGATED_PREFIXES，写明理由；\n` +
      `  3. 只有这一条接口要放行（跨权限点被调用的只读下拉）→ 加进 UNGATED_PATHS，写明理由。\n` +
      `  漏登记的后果是静默全开：任何登录用户都能调它。`;

    expect(isMapped(path), hint).toBe(true);
  });
});

describe("映射表自身是自洽的", () => {
  test("每个前缀映射到的都是真实存在的权限点", () => {
    for (const [prefix, permission] of Object.entries(PERMISSION_BY_PREFIX)) {
      expect(
        PERMISSION_KEYS,
        `前缀 ${prefix} 映射到了不存在的权限点 ${permission}`,
      ).toContain(permission);
    }
  });

  test("每个权限点都至少管着一个前缀", () => {
    const used = new Set(Object.values(PERMISSION_BY_PREFIX));
    for (const key of PERMISSION_KEYS) {
      // 建出一个谁都调不到的权限点，只会在角色管理页上多一个勾了没用的格子。
      expect(used, `权限点 ${key} 没有对应任何接口前缀`).toContain(key);
    }
  });

  test("豁免清单里的每条都写了理由", () => {
    for (const [path, reason] of Object.entries({
      ...UNGATED_PATHS,
      ...UNGATED_PREFIXES,
    })) {
      // 空理由等于把一个洞伪装成一次遗漏。
      expect(reason.trim().length, `${path} 的豁免理由是空的`).toBeGreaterThan(0);
    }
  });

  test("路径级豁免不会被前缀规则盖住", () => {
    for (const path of Object.keys(UNGATED_PATHS)) {
      expect(resolvePermission(path), `${path} 应当放行`).toBeNull();
    }
  });
});

describe("前缀匹配的边界", () => {
  test("最长前缀优先：invitation 的两个子前缀互不干扰", () => {
    expect(resolvePermission("/api/invitation/template/list")).toBeNull(); // 路径级豁免
    expect(resolvePermission("/api/invitation/template/delete")).toBe(
      "invitationTemplate",
    );
    expect(resolvePermission("/api/invitation/batch/create")).toBe("activity");
  });

  test("前缀按分段匹配，不按字符串前缀", () => {
    // `/api/member` 不该顺手管住一个叫 `/api/memberFoo` 的模块——那种模块要
    // 自己登记，否则就是静默全开。
    expect(resolvePermission("/api/memberFoo/list")).toBeNull();
    expect(isMapped("/api/memberFoo/list")).toBe(false);
    expect(resolvePermission("/api/member/list")).toBe("member");
  });

  test("查询自己的权限点不受权限点管（否则是循环依赖）", () => {
    expect(resolvePermission("/api/permission/mine")).toBeNull();
  });
});
