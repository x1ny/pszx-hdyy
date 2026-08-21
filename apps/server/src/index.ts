import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { activityConfigRoutes } from "./modules/activity-config/routes";
import { agendaRoutes } from "./modules/agenda/routes";
import { authHandler, sessionMiddleware, type Variables } from "./modules/auth";
import { exampleRoutes } from "./modules/example/routes";
import { fileRoutes } from "./modules/file/routes";
import { invitationRoutes } from "./modules/invitation/routes";
import { memberRoutes } from "./modules/member/routes";
import {
  activityMemberRoutes,
  projectMemberRoutes,
  segmentMemberRoutes,
} from "./modules/member/routes.relation";
import { activityRoutes, projectRoutes } from "./modules/project/routes";
import {
  activityResourceRoutes,
  resourceDemandRoutes,
} from "./modules/resource/routes";
import { supplierRoutes } from "./modules/supplier/routes";
import { supplierQuoteRoutes } from "./modules/supplier/routes.quote";
import { tripRoutes } from "./modules/trip/routes";
import { err } from "./shared/result";

const app = new Hono<{ Variables: Variables }>();

// 生产镜像把 web 的构建产物和 server 跑在同一个 Hono 里（见 docker/README.md）。
// 只有设了 WEB_DIST_DIR 才挂载 —— 开发环境不设，静态资源仍归 Vite，这里等于不存在。
const webDistDir = process.env.WEB_DIST_DIR?.trim();

if (webDistDir) {
  const staticFiles = serveStatic({
    root: webDistDir,
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
    root: webDistDir,
    path: "index.html",
    // 回落这条路径也必须显式 no-cache。不给头的话浏览器会启发式缓存 HTML，
    // 发版后深链拿到旧 index.html 去引用已经删掉的哈希资源，白屏。
    onFound: (_path, c) => {
      c.header("Cache-Control", "no-cache");
    },
  });

  // 挂在 sessionMiddleware **之前**。挂在后面的话，每个 js/css/字体请求都会
  // 触发一次 auth.api.getSession() 查库 —— 一次首屏加载几十个静态请求，
  // 就是几十次没有任何意义的数据库往返。
  app.use("*", async (c, next) => {
    // /api 一律不碰。少了这个判断，打错的接口路径会返回 200 的 index.html，
    // 前端把 "<!doctype html>" 塞进 JSON.parse，报错信息会完全指错方向。
    if (c.req.path.startsWith("/api")) {
      return next();
    }

    // 找得到文件就直接返回；找不到（/projects/123 这类前端路由被直接刷新）
    // 回落到 index.html 交给 TanStack Router。
    const fileResponse = await staticFiles(c, async () => {});
    if (fileResponse) {
      return fileResponse;
    }

    return indexHtml(c, next);
  });
}

// Order matters — see modules/auth/routes.ts for why Better Auth is mounted
// before the session middleware.
app.route("/", authHandler);

app.use("*", sessionMiddleware);

// Add new feature modules by chaining another .route("/api/<module>", xyzRoutes)
// here — only what's chained onto `routes` is visible to hc<AppType> on the
// client. Each module owns one prefix, so a module's `.use(requireUser)`
// (or lack of one, see file below) only ever scopes to its own prefix —
// it can't leak onto routes registered elsewhere in this chain regardless
// of ordering.
// 导出是给 `scripts/gen-api-docs.ts` 用的：文档生成器 import 这个实例、读
// `app.routes`，接口清单就永远等于真正注册的路由。运行时入口仍然是下面的
// default export，这里多一个具名导出不改变任何行为。
export const routes = app
  .route("/api/example", exampleRoutes)
  .route("/api/supplier", supplierRoutes)
  // 报价附件是 supplier 模块下的子资源，按约定另占一个前缀（理由写在
  // modules/supplier/routes.quote.ts 的文件头注释里）。
  .route("/api/supplierQuote", supplierQuoteRoutes)
  .route("/api/member", memberRoutes)
  // 人员分层的三层关系各占一个前缀。它们和 /api/member 同属 modules/member
  // （三张关系表 + 补齐链路必须跟主档待在一个模块，否则 BR-DEV-026 的跨层
  // 事务会在 project/agenda 之间绕成循环依赖），但接口按层分开挂——查询条件、
  // 返回列、将来的权限点三层都不一样，糊成一个 ?scope= 入口只会让投影失焦。
  .route("/api/projectMember", projectMemberRoutes)
  .route("/api/activityMember", activityMemberRoutes)
  .route("/api/segmentMember", segmentMemberRoutes)
  .route("/api/invitation", invitationRoutes)
  // File upload and file reads are intentionally public — no requireUser
  // in modules/file/routes.ts, and that's safe now: the prefix means no
  // other module's auth guard can accidentally cover it either.
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

export default {
  port: Number(process.env.SERVER_PORT ?? 8787),
  fetch: app.fetch,
};
