import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "../../infra/db";
import { isPlaceholderEmail } from "../../shared/placeholder-email";
import * as schema from "./schema";

const DEFAULT_SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

const getSessionExpiresInSeconds = () => {
  const raw =
    process.env.BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS?.trim() ||
    String(DEFAULT_SESSION_EXPIRES_IN_SECONDS);
  const seconds = Number(raw);

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(
      `BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS must be a positive integer, got "${raw}"`,
    );
  }

  return seconds;
};

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  // 登录标识是**账号**不是邮箱，见 docs/user-management-design.md。
  //
  // 插件加两列：`username`（唯一，小写归一，登录匹配用）和 `displayUsername`
  // （原样大小写，界面展示用）。旧库里有 `Csry` `Htgl` 这种混合大小写的账号名，
  // 靠后者保住原貌，同时登录时大小写不敏感。
  //
  // 长度和字符集用插件默认（3–30 位、`/^[a-zA-Z0-9_.]+$/`），这里显式写出来是
  // 因为它是**决策**不是默认值：旧库 8 个账号全部落在这个范围内，且没有一个用
  // 中文——中文账号名登录时要切输入法，而中文姓名由 `name` 列承载。
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
    }),
  ],
  /**
   * **账号和邮箱两种登录方式都支持**（`/sign-in/username` 和 `/sign-in/email`，
   * 插件是新增端点不是替换）。前端按输入里有没有 `@` 分流，见 routes/login.tsx。
   *
   * 这里只堵一件事：拿**占位邮箱**登录。没填邮箱的人库里存的是
   * `<账号>@local.invalid`，那是从账号名机械派生的，等于给他凭空多出一条可推导的
   * 登录标识——不是漏洞（照样要密码），但是纯噪音，理由见 shared/placeholder-email.ts。
   *
   * 错误码复用 `INVALID_EMAIL_OR_PASSWORD` 而不是新造一个：告诉对方"这个邮箱是
   * 占位值"等于确认了这个账号存在。
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;

      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email === "string" && isPlaceholderEmail(email)) {
        throw new APIError("UNAUTHORIZED", {
          code: "INVALID_EMAIL_OR_PASSWORD",
          message: "邮箱或密码错误",
        });
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        /**
         * 被停用的账号**不发 session**，也就是登不进来。
         *
         * 这一层不能省，`session-middleware.ts` 那层顶不上：中间件挂在
         * `authHandler` **之后**，`/api/auth/*` 整个走不到它。少了这个钩子，被停用
         * 的人仍然能登录成功、Better Auth 的 `getSession` 也照样认——于是前端守卫
         * 放他进应用外壳，然后每一个业务请求返回 UNAUTHORIZED。用户看到的是一个
         * 处处报错的空壳，而不是一句"账号已停用"。（这个坏状态是实测出来的，不是
         * 推演。）
         *
         * 两层的分工：这里管**新登录**，中间件管**已经握着 session 的人**——
         * 那种情况还额外靠 `/setStatus` 主动删 session 行来即时踢出。
         */
        before: async (session) => {
          const [row] = await db
            .select({ status: schema.user.status })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId));

          if (row && row.status !== "enabled") {
            throw new APIError("FORBIDDEN", {
              // 这个 code 会原样进到登录页的错误映射表（routes/login.tsx）。
              code: "ACCOUNT_DISABLED",
              message: "该账号已被停用，请联系管理员",
            });
          }
        },
      },
    },
  },
  session: {
    expiresIn: getSessionExpiresInSeconds(),
  },
  // The web app reaches the server through Vite's /api proxy, so the browser
  // only ever sees one origin. If you split the deployment across two domains,
  // add the web origin here and enable the CORS middleware in src/index.ts.
  trustedOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:3000"],
});
