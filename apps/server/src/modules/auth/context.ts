import type { PermissionKey } from "../../shared/permissions";
import type { auth } from "./auth";

// The shape the session middleware puts on Hono's context. Any module that
// needs `c.get("user")` imports this — it's the module's public contract,
// not an implementation detail of index.ts.
export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
  /**
   * 当前用户所有角色的权限点**并集**（未登录时是空数组，不是 null——调用方一律
   * `.includes()`，少一个判空分支）。
   *
   * 并集意味着没有"拒绝"语义：一旦某个角色能显式禁止某操作，"这个人到底能不能点
   * 这个按钮"就要靠优先级规则推演。理由见 modules/user/schema.ts。
   */
  permissions: PermissionKey[];
};
