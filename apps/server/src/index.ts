import type { Server } from "bun";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { activityConfigRoutes } from "./modules/activity-config/routes";
import { agendaRoutes } from "./modules/agenda/routes";
import {
  assertDevAuthIsSafe,
  authHandler,
  devAuthRoutes,
  isDevAuthEnabled,
  sessionMiddleware,
  type Variables,
} from "./modules/auth";
import { exampleRoutes } from "./modules/example/routes";
import { fileRoutes } from "./modules/file/routes";
import { invitationRoutes } from "./modules/invitation/routes";
import { memberRoutes } from "./modules/member/routes";
import {
  activityMemberRoutes,
  projectMemberRoutes,
  segmentMemberRoutes,
} from "./modules/member/routes.relation";
import { organizationRoutes } from "./modules/organization/routes";
import { activityRoutes, projectRoutes } from "./modules/project/routes";
import {
  activityResourceRoutes,
  resourceDemandRoutes,
} from "./modules/resource/routes";
import { seatingRoutes } from "./modules/seating/routes";
import { supplierRoutes } from "./modules/supplier/routes";
import { supplierQuoteRoutes } from "./modules/supplier/routes.quote";
import { tripRoutes } from "./modules/trip/routes";
import { venueRoutes } from "./modules/venue/routes";
import { activityVenueRoutes } from "./modules/venue/routes.activity";
import { err } from "./shared/result";

// 生产镜像把前端的构建产物和 server 跑在同一个 Hono 里（见 docker/README.md）。
// 管理端和 h5 各占一个端口，**两个端口共用下面这一整套路由**（/api 也在内），
// 所以两边各自同源，不需要 CORS。端口之间唯一的差别就是静态资源目录，它通过
// Hono 的 bindings 由每个 server 各自传进来（见文件末尾）。
//
// 只有设了对应的 *_DIST_DIR 才有静态托管 —— 开发环境两个都不设，静态资源仍归 Vite。
function createStaticApp(distDir: string) {
  const files = serveStatic({
    root: distDir,
    onFound: (path, c) => {
      // Vite 的产物文件名带内容哈希，可以永久缓存；index.html 不带，缓存了就
      // 再也发不出新版本。
      c.header(
        "Cache-Control",
        path.replace(/\\/g, "/").includes("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
    },
  });
  const indexHtml = serveStatic({
    root: distDir,
    path: "index.html",
    // 回落这条路径也必须显式 no-cache。不给头的话浏览器会启发式缓存 HTML，
    // 发版后深链拿到旧 index.html 去引用已经删掉的哈希资源，白屏。
    onFound: (_path, c) => {
      c.header("Cache-Control", "no-cache");
    },
  });

  return { files, indexHtml };
}

type StaticApp = ReturnType<typeof createStaticApp>;

// `server` 这一项不是可选的装饰：`hono/bun` 的 getConnInfo 要从 c.env 里取 Bun
// 的 Server 才能调 requestIP()，免密登录入口的回环地址检查就靠它
// （modules/auth/routes.dev.ts）。Hono 的 Bun 适配器认两种形状——c.env 本身就是
// Server，或者 c.env.server 是 Server——我们要在同一个 env 里塞第二样东西，所以
// 只能用后者。漏掉它的话那条路由会直接抛 TypeError。
type Bindings = { server: Server<unknown>; staticApp?: StaticApp };

const webDistDir = process.env.WEB_DIST_DIR?.trim();
const h5DistDir = process.env.H5_DIST_DIR?.trim();
const webStaticApp = webDistDir ? createStaticApp(webDistDir) : undefined;
const h5StaticApp = h5DistDir ? createStaticApp(h5DistDir) : undefined;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

if (webStaticApp || h5StaticApp) {
  // 挂在 sessionMiddleware **之前**。挂在后面的话，每个 js/css/字体请求都会
  // 触发一次 auth.api.getSession() 查库 —— 一次首屏加载几十个静态请求，
  // 就是几十次没有任何意义的数据库往返。
  app.use("*", async (c, next) => {
    // 取的是**当前这个端口**的静态目录；没有就说明这个端口只提供 API。
    const staticApp = c.env.staticApp;

    // /api 一律不碰。少了这个判断，打错的接口路径会返回 200 的 index.html，
    // 前端把 "<!doctype html>" 塞进 JSON.parse，报错信息会完全指错方向。
    if (!staticApp || c.req.path.startsWith("/api")) {
      return next();
    }

    // 找得到文件就直接返回；找不到（/projects/123 这类前端路由被直接刷新）
    // 回落到 index.html 交给 TanStack Router。
    const fileResponse = await staticApp.files(c, async () => {});
    if (fileResponse) {
      return fileResponse;
    }

    return staticApp.indexHtml(c, next);
  });
}

// Order matters — see modules/auth/routes.ts for why Better Auth is mounted
// before the session middleware.
app.route("/", authHandler);

// 开发专用的免密登录后门，只在 DEV_AUTH_BYPASS=1 时才存在
// （理由和安全边界写在 modules/auth/routes.dev.ts 的文件头）。
// 断言无条件执行：生产形态下开着这个开关会直接抛错拒绝启动，而不是安静跳过。
assertDevAuthIsSafe();

if (isDevAuthEnabled()) {
  // 刻意挂在 `routes` 链之外：它不进 AppType，前端拿不到它的类型，
  // 也就不可能有前端代码不小心依赖上一个开发后门。
  app.route("/api/dev", devAuthRoutes);
}

app.use("*", sessionMiddleware);

// Add new feature modules by chaining another .route("/api/<module>", xyzRoutes)
// here — only what's chained onto `routes` is visible to hc<AppType> on the
// client. Each module owns one prefix, so its auth middleware (module-wide or
// route-specific, as in file) only ever scopes to its own prefix — it can't
// leak onto routes registered elsewhere in this chain regardless of ordering.
// 导出是给 `scripts/gen-api-docs.ts` 用的：文档生成器 import 这个实例、读
// `app.routes`，接口清单就永远等于真正注册的路由。运行时入口仍然是下面的
// default export，这里多一个具名导出不改变任何行为。
export const routes = app
  .route("/api/example", exampleRoutes)
  .route("/api/supplier", supplierRoutes)
  // 报价附件是 supplier 模块下的子资源，按约定另占一个前缀（理由写在
  // modules/supplier/routes.quote.ts 的文件头注释里）。
  .route("/api/supplierQuote", supplierQuoteRoutes)
  .route("/api/organization", organizationRoutes)
  .route("/api/member", memberRoutes)
  // 人员分层的三层关系各占一个前缀。它们和 /api/member 同属 modules/member
  // （三张关系表 + 补齐链路必须跟主档待在一个模块，否则 BR-DEV-026 的跨层
  // 事务会在 project/agenda 之间绕成循环依赖），但接口按层分开挂——查询条件、
  // 返回列、将来的权限点三层都不一样，糊成一个 ?scope= 入口只会让投影失焦。
  .route("/api/projectMember", projectMemberRoutes)
  .route("/api/activityMember", activityMemberRoutes)
  .route("/api/segmentMember", segmentMemberRoutes)
  .route("/api/invitation", invitationRoutes)
  // File upload enforces its own login check; file reads stay public for
  // browser previews and downloads. The module owns this prefix, so guards
  // from other modules cannot accidentally cover it.
  .route("/api/file", fileRoutes)
  .route("/api/project", projectRoutes)
  .route("/api/activity", activityRoutes)
  .route("/api/agenda", agendaRoutes)
  // 资源的两层各占一个前缀，理由同人员分层：环节资源需求项是声明层（按活动
  // 全量查、按环节整体保存），活动资源台账是记录层（分页、按类型筛选、带人员
  // 绑定）——查询条件、返回列和将来的权限点都不一样，糊成一个前缀只会让字段
  // 投影失焦。
  .route("/api/resourceDemand", resourceDemandRoutes)
  .route("/api/activityResource", activityResourceRoutes)
  .route("/api/trip", tripRoutes)
  // 场地三层，依赖方向严格单向（docs/场地排位底层设计.md §2）：
  //   venue         跨活动复用的场地库，不知道后两者的存在
  //   activityVenue 活动从场地库拷贝下来的一份空间，归 venue 模块，不认识排位
  //   seating       环节排位，只读上面两层 + member + agenda
  // 反过来任何一条都不允许——venue 加了对 seating 的依赖，场地库就再也不能
  // 独立使用了。
  .route("/api/venue", venueRoutes)
  .route("/api/activityVenue", activityVenueRoutes)
  .route("/api/seating", seatingRoutes)
  // 只读的配置完整性视图，没有自己的表——它把环节、人员、资源几个模块的
  // 现状聚合成一张体检表。放在最后注册，因为它依赖上面所有模块。
  .route("/api/activityConfig", activityConfigRoutes);

// Catches anything a handler didn't turn into a `code`, i.e. a real crash —
// the one case where the response legitimately isn't a business outcome.
app.onError((error, c) => {
  console.error(error);
  return c.json(
    err({ code: "INTERNAL_ERROR", message: "服务器内部错误" }),
    500,
  );
});

export type AppType = typeof routes;

// 不设 SERVER_HOST 时保持 Bun 的默认行为（绑所有接口）—— 生产镜像走的就是
// 这条路。开发编排会显式传 127.0.0.1（scripts/dev.ts）：Bun 默认绑全部接口，
// 实测局域网 IP 可达，而开发环境挂着 /api/dev/login 这个免密入口，不限制的话
// 同网段任何人都能签出一个真实 session。
const serverHost = process.env.SERVER_HOST?.trim();

// h5 的端口。跑的是同一个 `app`，只是绑了另一个静态目录 —— /api 在这个端口上
// 一样存在，所以 h5 和它调的接口天然同源。
//
// 只有设了 H5_DIST_DIR 才起，这一点有两个作用：开发环境（前端归 Vite）不会白占
// 一个端口；`scripts/gen-api-docs.ts` import 这个模块去读路由表时，也不会因为
// 副作用意外 listen。
//
// 这里必须显式 Bun.serve —— 一个模块只能有一个 default export。而显式 listen
// 和 `--hot` 是冲突的（热重载重新执行模块会重复绑定端口），两个条件正好互斥：
// 需要第二个端口的生产形态没有 --hot，有 --hot 的开发形态不设 H5_DIST_DIR。
if (h5StaticApp) {
  Bun.serve({
    port: Number(process.env.H5_PORT ?? 8788),
    ...(serverHost ? { hostname: serverHost } : {}),
    fetch: (request, server) =>
      app.fetch(request, { server, staticApp: h5StaticApp }),
  });
}

export default {
  port: Number(process.env.SERVER_PORT ?? 8787),
  ...(serverHost ? { hostname: serverHost } : {}),
  // 不能简写成 `fetch: app.fetch`：那样 c.env 就只是 Bun 的 Server，静态中间件
  // 读不到 staticApp。但 Server 本身也不能丢——见上面 Bindings 的注释。
  fetch: (request: Request, server: Server<unknown>) =>
    app.fetch(request, { server, staticApp: webStaticApp }),
};
