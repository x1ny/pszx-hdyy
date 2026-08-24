import { eq } from "drizzle-orm";
import { auth } from "../modules/auth/auth";
import { user } from "../modules/auth/schema";
import { DEV_ACCOUNT } from "../shared/dev-account";
import type { SeedFn } from "./context";

export const seed: SeedFn = async (db, context) => {
  // 走 Better Auth 自己的注册接口，而不是手写 user/account 两张表：密码哈希的
  // 算法和参数归它管，手写一份必然在某次升级之后悄悄失配，而失配的表现是
  // 「登录接口返回 401」这种查起来完全不指向种子的症状。
  await auth.api.signUpEmail({
    body: {
      email: DEV_ACCOUNT.email,
      password: DEV_ACCOUNT.password,
      name: DEV_ACCOUNT.name,
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

  // 后面所有种子的 createdBy / updatedBy 都用它。
  context.userId = created.id;
};
