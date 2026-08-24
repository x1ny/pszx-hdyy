import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { DEV_ACCOUNT } from "../../shared/dev-account";
import { auth } from "./auth";
import type { Variables } from "./context";

// 开发专用的免密登录入口。
//
// 存在的理由很具体：coding agent 受「不得代替用户输入密码进行认证」这条硬性
// 规则约束，把账号密码写进 AGENTS.md 只会让它更不敢动手。这条路由让 agent
// 不需要碰密码输入框就能拿到登录态 —— 一次 GET /api/dev/login 即可。
//
// 它**走的是完整的真实认证链路**（Better Auth 签发真 session、真 cookie，
// 后续请求照常过 sessionMiddleware），不是把守卫短路掉。所以 _authenticated
// 守卫、会话过期、登录后必须 removeQueries 这些坑在开发环境照样能暴露出来 ——
// 换成「dev 模式直接注入用户」的做法，这类 bug 就只会在生产环境露头。
//
// 三道闸，缺一不可：
//   1. APP_ENV=development —— 开发白名单，只有根 dev runner 会设
//   2. DEV_AUTH_BYPASS=1   —— 显式开关
//   3. 请求来自回环地址     —— 见 requireLoopback
// 前两道是**白名单**不是黑名单：早先只判断「看起来像不像生产」，那是一份
// 永远补不全的清单（`bun run start` 两个变量都不设，前后端分域名部署也可能
// 没有 WEB_DIST_DIR）。现在反过来，只有明确是开发形态才允许。

const ENV_FLAG = "DEV_AUTH_BYPASS";
const APP_ENV_FLAG = "APP_ENV";
const DEV_APP_ENV = "development";

const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
]);

const isDevAppEnv = () => process.env[APP_ENV_FLAG]?.trim() === DEV_APP_ENV;

/** 白名单：两个变量都对上才存在这条路由。 */
export const isDevAuthEnabled = () =>
  process.env[ENV_FLAG] === "1" && isDevAppEnv();

/**
 * 开着开关却不是开发形态就拒绝启动，而不是安静地跳过挂载。
 *
 * 除了白名单，额外保留两个生产特征的否决项：即使有人把 APP_ENV 也设成了
 * development，只要进程同时表现出生产形态（托管前端产物、NODE_ENV=production），
 * 依然拒绝。后门要么不存在，要么响亮地不存在。
 */
export function assertDevAuthIsSafe() {
  if (process.env[ENV_FLAG] !== "1") {
    return;
  }

  if (!isDevAppEnv()) {
    throw new Error(
      `${ENV_FLAG}=1 但 ${APP_ENV_FLAG} 不是 "${DEV_APP_ENV}"。这是开发专用的` +
        "免密登录后门，只有根目录的 `bun run dev` 会同时设置这两个变量，拒绝启动。",
    );
  }

  const looksLikeProduction =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.WEB_DIST_DIR?.trim());

  if (looksLikeProduction) {
    throw new Error(
      `${ENV_FLAG}=1 出现在生产形态的进程里（检测到 NODE_ENV=production 或 WEB_DIST_DIR），拒绝启动。`,
    );
  }
}

/**
 * 只接受同源的站内路径。
 *
 * 不能只判断开头的 `/` 和 `//`：URL 标准把反斜杠当路径分隔符，`/\evil.example`
 * （以及解码后等价的 `/%5Cevil.example`）会解析到外站 origin，形成开放重定向。
 * 交给 URL 解析器判定，比枚举可疑前缀可靠。
 */
const SAFE_BASE = "http://dev.invalid";

export function safeRedirectTarget(raw: string | undefined | null) {
  if (!raw) {
    return "/";
  }

  try {
    const url = new URL(raw, SAFE_BASE);
    return url.origin === SAFE_BASE
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export function isLoopbackAddress(address: string | undefined) {
  return Boolean(address && LOOPBACK_ADDRESSES.has(address));
}

export const devAuthRoutes = new Hono<{ Variables: Variables }>().get(
  "/login",
  async (c) => {
    // 第三道闸。开发时后端已经只绑回环（scripts/dev.ts 传 SERVER_HOST），
    // 这里再挡一次是因为绑定方式将来可能被改，而这条路由的后果是
    // 「任何人拿到一个真实 session」，不该只由一层保护。
    if (!isLoopbackAddress(getConnInfo(c).remote.address)) {
      return c.text("免密登录只对本机开放。", 403);
    }

    const signedIn = await auth.api.signInEmail({
      body: { email: DEV_ACCOUNT.email, password: DEV_ACCOUNT.password },
      asResponse: true,
    });

    if (!signedIn.ok) {
      return c.text(
        `开发账号登录失败（${signedIn.status}）。多半是这个库没灌种子：` +
          "确认用 `bun run dev` 起的临时库，而不是连到了别处。",
        500,
      );
    }

    const headers = new Headers({
      Location: safeRedirectTarget(c.req.query("redirect")),
    });
    // 原样透传 Better Auth 签发的 cookie，不自己拼 —— cookie 名、签名、
    // SameSite 都归它管。
    for (const cookie of signedIn.headers.getSetCookie()) {
      headers.append("Set-Cookie", cookie);
    }

    return new Response(null, { status: 302, headers });
  },
);
