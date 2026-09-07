import { eq } from "drizzle-orm";
import { auth } from "../modules/auth/auth";
import { user } from "../modules/auth/schema";
import {
  BUILTIN_MANAGER_ROLE_NAME,
  BUILTIN_ROLE_NAME,
} from "../modules/user/bootstrap";
import { role, userRole } from "../modules/user/schema";
import { DEV_ACCOUNT } from "../shared/dev-account";
import { ALL_PERMISSIONS } from "../shared/permissions";
import type { SeedFn } from "./context";

export const seed: SeedFn = async (db, context) => {
  // 走 Better Auth 自己的注册接口，而不是手写 user/account 两张表：密码哈希的
  // 算法和参数归它管，手写一份必然在某次升级之后悄悄失配，而失配的表现是
  // 「登录接口返回 401」这种查起来完全不指向种子的症状。
  //
  // 公网自助注册已经关掉了，但那道闸挂在 Hono 层（index.ts），拦的是 HTTP
  // 请求；这里是服务端直接调用，不受影响。
  await auth.api.signUpEmail({
    body: {
      email: DEV_ACCOUNT.email,
      password: DEV_ACCOUNT.password,
      name: DEV_ACCOUNT.name,
      // 插件会把它归一到 `username`，并把原样大小写填进 `displayUsername`。
      username: DEV_ACCOUNT.username,
    },
  });

  // 回读而不是用返回值：id 由 Better Auth 生成，回读让这里不依赖它的返回结构。
  const [created] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, DEV_ACCOUNT.email))
    .limit(1);

  if (!created) {
    throw new Error(`注册成功但读不回 ${DEV_ACCOUNT.email}`);
  }

  // 标成内置管理员，让开发库和生产库长得一样：`bootstrapBuiltinAdmin()` 在服务
  // 启动时找的就是这个标记，找到了就跳过引导。不标的话每次 `bun run dev` 都会
  // 因为缺 ADMIN_USERNAME / ADMIN_PASSWORD 而拒绝启动。
  //
  // 两个内置角色都建出来、都灌满权限点，和 `syncBuiltinRoles()` 在生产库里干的
  // 事情保持一致——开发库和生产库长得一样，权限相关的坑才会在开发时就暴露。
  const [builtinRole] = await db
    .insert(role)
    .values([
      {
        name: BUILTIN_ROLE_NAME,
        permissions: ALL_PERMISSIONS,
        remark: "系统内置，拥有全部权限，不可修改或删除",
      },
      {
        name: BUILTIN_MANAGER_ROLE_NAME,
        permissions: ALL_PERMISSIONS,
        remark: "系统内置，拥有全部权限，可分配给管理人员，不可修改或删除",
      },
    ])
    .returning({ id: role.id });

  if (!builtinRole) {
    throw new Error(`创建角色「${BUILTIN_ROLE_NAME}」失败`);
  }

  // 一个**权限受限**的角色，专门用来在开发时验证闸门真的拦得住。没有它的话
  // 每次调试都是超管视角，403 那条路径永远走不到。
  await db.insert(role).values({
    name: "供应商专员",
    permissions: ["supplier"],
    remark: "开发种子：只能进供应商管理，用来验证权限闸门",
  });

  await db.update(user).set({ isBuiltin: true }).where(eq(user.id, created.id));
  await db
    .insert(userRole)
    .values({ userId: created.id, roleId: builtinRole.id });

  // 后面所有种子的 createdBy / updatedBy 都用它。
  context.userId = created.id;
};
