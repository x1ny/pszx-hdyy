import type { MiddlewareHandler } from "hono";
import { auth } from "./auth";
import type { Variables } from "./context";

// Populates c.get("user") / c.get("session") for every route registered
// after this middleware. Does not run for /api/auth/* — see routes.ts.
export const sessionMiddleware: MiddlewareHandler<{
  Variables: Variables;
}> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);
  await next();
};
