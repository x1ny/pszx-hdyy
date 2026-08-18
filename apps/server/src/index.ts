import { Hono } from "hono";
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
import { err } from "./shared/result";

const app = new Hono<{ Variables: Variables }>();

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
const routes = app
  .route("/api/example", exampleRoutes)
  .route("/api/supplier", supplierRoutes)
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
  .route("/api/activityResource", activityResourceRoutes);

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
