import { Hono } from "hono";
import { agendaRoutes } from "./modules/agenda/routes";
import { authHandler, sessionMiddleware, type Variables } from "./modules/auth";
import { exampleRoutes } from "./modules/example/routes";
import { fileRoutes } from "./modules/file/routes";
import { invitationRoutes } from "./modules/invitation/routes";
import { memberRoutes } from "./modules/member/routes";
import { activityRoutes, projectRoutes } from "./modules/project/routes";
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
  .route("/api/invitation", invitationRoutes)
  // File upload and file reads are intentionally public — no requireUser
  // in modules/file/routes.ts, and that's safe now: the prefix means no
  // other module's auth guard can accidentally cover it either.
  .route("/api/file", fileRoutes)
  .route("/api/project", projectRoutes)
  .route("/api/activity", activityRoutes)
  .route("/api/agenda", agendaRoutes);

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
