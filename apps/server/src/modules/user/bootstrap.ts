import { eq } from "drizzle-orm";
import { db } from "../../infra/db";
import { ALL_PERMISSIONS } from "../../shared/permissions";
import { toStoredEmail } from "../../shared/placeholder-email";
import { auth } from "../auth";
import { user } from "../auth/schema";
import { role, userRole } from "./schema";
import { PasswordInput, UsernameInput } from "./validation";

/**
 * 内置超管挂的角色名。**dev-seed 也用这个常量**，两边必须指向同一个名字，否则
 * 开发库里会长出两条只差空格的"超级管理员"。
 */
export const BUILTIN_ROLE_NAME = "超级管理员";

/**
 * 第二个内置角色。和「超级管理员」同样恒等于全部权限点、同样不可改不可删，
 * 区别只在于**它是拿来分配给人的**——「超级管理员」绑的是引导出来的那一个
 * `isBuiltin` 账号，是最后一条回来的路，不该日常挂在同事身上。
 */
export const BUILTIN_MANAGER_ROLE_NAME = "管理员";

/** 两个内置角色都不可编辑权限、不可删除。角色 CRUD 用这个判定。 */
export const BUILTIN_ROLE_NAMES: readonly string[] = [
  BUILTIN_ROLE_NAME,
  BUILTIN_MANAGER_ROLE_NAME,
];

/**
 * 把两个内置角色的权限点同步为**代码里的全集**，缺角色就建。
 *
 * **每次启动都跑，不看库里有没有内置账号**——这是它和 `bootstrapBuiltinAdmin()`
 * 的关键区别（后者见到 `isBuiltin` 就直接返回）。
 *
 * 为什么要每次同步：权限点是代码里的清单，角色的勾选在库里。agent 新增一个菜单项
 * 就多一个权限点，而线上库里那两个内置角色**不会自动获得它**——超管会突然进不去
 * 新页面。写个测试盯不住这件事（测试拦不住已经部署的库），只有"重启即自愈"能。
 *
 * 这个模式在本文件里不是新东西：`createOrAdoptAdmin` 的接管分支、
 * `ensureBuiltinRole` 的按名查找，都是同一个"幂等 + 从半途状态自愈"的思路。
 *
 * 代价是**内置角色的权限点在界面上不可编辑**（改了下次重启就被覆盖），角色管理
 * 的 CRUD 因此显式拒绝编辑它们，而不是让运营改完发现改了个寂寞。
 */
export const syncBuiltinRoles = async () => {
  for (const name of BUILTIN_ROLE_NAMES) {
    await db
      .insert(role)
      .values({
        name,
        permissions: ALL_PERMISSIONS,
        remark:
          name === BUILTIN_ROLE_NAME
            ? "系统内置，拥有全部权限，不可修改或删除"
            : "系统内置，拥有全部权限，可分配给管理人员，不可修改或删除",
      })
      // 只同步权限点。`remark` 不进 set —— 覆盖它会把运营写的备注每次重启抹掉，
      // 而备注不影响任何判断。
      .onConflictDoUpdate({
        target: role.name,
        set: { permissions: ALL_PERMISSIONS },
      });
  }
};

/**
 * 生产引导：保证库里**始终存在一个内置超管**。
 *
 * ## 为什么必须有这个东西
 *
 * 自助注册已经在 Hono 层封死（见 index.ts），而账号只能由已登录的管理员创建。
 * 于是全新部署的库会陷入死锁：**没有人能登录，也就没有人能建第一个账号**。
 *
 * ## 为什么判据是"有没有 isBuiltin"而不是"表是不是空的"
 *
 * 现有的开发持久库和任何已经跑起来的环境里都已经有用户了（全是关闭注册之前
 * 注册出来的，一个 `isBuiltin` 都没有）。按空表判断，这些库永远等不到内置超管；
 * 按 `isBuiltin` 判断，它们下次重启就自动补上——**升级路径和全新部署走同一条
 * 逻辑**，不需要一份一次性迁移脚本。
 *
 * ## 为什么在 index.ts 里跑而不是做成第三个入口
 *
 * 镜像里只有 `migrate.js` 和 `server.js` 两个产物（见 docker/Dockerfile），加一个
 * 要同时改 Dockerfile、build 脚本和 entrypoint。挂在 server 的启动路径上还顺带
 * 保证了它在**所有**运行形态里都会跑（容器、`bun run start`、`bun run dev`）。
 *
 * 而 `migrate.ts` 那边接不了：那条 import 链刻意只有 drizzle-orm 和 pg，把
 * Better Auth 拽进去会让 `dist/migrate.js` 胖一圈（理由写在 migrate.ts 头部）。
 */
export const bootstrapBuiltinAdmin = async () => {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.isBuiltin, true))
    .limit(1);

  if (existing) return;

  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    // **拒绝启动，而不是安静跳过。** 安静跳过的后果是"部署成功但没人能登录"，
    // 而那个现象第一时间不会指向这里。同 assertDevAuthIsSafe() 和
    // getSessionExpiresInSeconds() 的处理：在部署那一刻响亮地失败。
    throw new Error(
      "库里没有内置管理员账号，且未配置 ADMIN_USERNAME / ADMIN_PASSWORD。\n" +
        "  首次部署请设置这两个环境变量，容器启动时会用它们创建内置管理员；\n" +
        "  创建成功后它们就不再被读取，可以从部署配置里移除。",
    );
  }

  // 先按我们自己的 schema 校验一遍：环境变量里打错字（比如密码只有 6 位），
  // 在这里报一条中文错误，比让它掉进 Better Auth 抛一个英文 APIError 好查。
  const parsedName = UsernameInput.safeParse(username);
  if (!parsedName.success) {
    throw new Error(
      `ADMIN_USERNAME 不合法：${parsedName.error.issues[0]?.message}`,
    );
  }
  const parsedPassword = PasswordInput.safeParse(password);
  if (!parsedPassword.success) {
    throw new Error(
      `ADMIN_PASSWORD 不合法：${parsedPassword.error.issues[0]?.message}`,
    );
  }

  const adminId = await createOrAdoptAdmin(username, password);
  const roleId = await ensureBuiltinRole();

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ isBuiltin: true, status: "enabled" })
      .where(eq(user.id, adminId));
    await tx
      .insert(userRole)
      .values({ userId: adminId, roleId })
      // 复合主键，重跑时不该炸。
      .onConflictDoNothing();
  });

  console.log(`[bootstrap] 已创建内置管理员账号 ${username}`);
};

/**
 * 建号；账号名已被占用时**接管那个账号并重置它的密码**。
 *
 * 接管这条分支不是为了方便，是为了两件事：
 *
 * 1. **从半途失败中自愈。** 建号和"标记 isBuiltin"不在同一个事务里（`auth.api`
 *    走的是它自己的连接，并不进 `db.transaction`），中间断电会留下一个建出来了
 *    但没标记的账号，下次启动就卡在"账号已存在"上再也起不来。
 * 2. **接管必须连密码一起重置。** 关闭注册之前有可能已经有人注册了同名账号；
 *    只标记 isBuiltin 而留着旧密码，等于把超管交给那个人。重置之后这个账号的
 *    控制权只在配了环境变量的运维手上。
 */
const createOrAdoptAdmin = async (username: string, password: string) => {
  try {
    const created = await auth.api.signUpEmail({
      body: {
        // 内置管理员没有邮箱，走和普通用户一样的占位值逻辑。
        email: toStoredEmail(undefined, username),
        password,
        name: "管理员",
        username,
      },
    });
    return created.user.id;
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    const taken =
      code === "USERNAME_IS_ALREADY_TAKEN" ||
      code === "USER_ALREADY_EXISTS" ||
      code === "EMAIL_ALREADY_EXISTS";
    if (!taken) throw error;

    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, username.toLowerCase()));

    if (!row) {
      throw new Error(
        `ADMIN_USERNAME=${username} 已被占用，但按该账号名查不到用户。` +
          "可能是邮箱撞了——换一个 ADMIN_USERNAME 再试。",
      );
    }

    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(
      row.id,
      await ctx.password.hash(password),
    );
    console.log(
      `[bootstrap] 账号 ${username} 已存在，接管为内置管理员并重置密码`,
    );
    return row.id;
  }
};

/**
 * 取内置超管角色的 id。
 *
 * 这里不再兜底新建：角色由 `syncBuiltinRoles()` 保证存在，而它在 `index.ts` 里
 * 跑在引导**之前**、且每次启动都跑。留着一条"找不到就建一个"的分支，只会在
 * 那个前提被人改坏时建出一个**没有任何权限点**的超管角色，然后症状表现为
 * "超管登录进去什么都点不了"——比直接抛错难查得多。
 */
const ensureBuiltinRole = async () => {
  const [found] = await db
    .select({ id: role.id })
    .from(role)
    .where(eq(role.name, BUILTIN_ROLE_NAME));

  if (!found) {
    throw new Error(
      `角色「${BUILTIN_ROLE_NAME}」不存在——syncBuiltinRoles() 应该在引导之前跑过`,
    );
  }
  return found.id;
};
