import { eq } from "drizzle-orm";
import { auth } from "../modules/auth/auth";
import { user } from "../modules/auth/schema";
import { BUILTIN_ROLE_NAME } from "../modules/user/bootstrap";
import { role, userRole } from "../modules/user/schema";
import { DEV_ACCOUNT } from "../shared/dev-account";
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
  const [builtinRole] = await db
    .insert(role)
    .values({ name: BUILTIN_ROLE_NAME, remark: "系统内置" })
    .returning({ id: role.id });

  if (!builtinRole) {
    throw new Error(`创建角色「${BUILTIN_ROLE_NAME}」失败`);
  }

  await db.update(user).set({ isBuiltin: true }).where(eq(user.id, created.id));
  await db
    .insert(userRole)
    .values({ userId: created.id, roleId: builtinRole.id });

  // 后面所有种子的 createdBy / updatedBy 都用它。
  context.userId = created.id;
};
