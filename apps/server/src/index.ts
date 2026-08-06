import { Hono } from "hono";
import { authHandler, sessionMiddleware, type Variables } from "./modules/auth";
import { exampleRoutes } from "./modules/example/routes";
import { err } from "./shared/result";

const app = new Hono<{ Variables: Variables }>();

// Order matters — see modules/auth/routes.ts for why Better Auth is mounted
// before the session middleware.
app.route("/", authHandler);

app.use("*", sessionMiddleware);

// Add new feature modules by chaining another .route("/", xyzRoutes) here —
// only what's chained onto `routes` is visible to hc<AppType> on the client.
const routes = app.route("/", exampleRoutes);

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
