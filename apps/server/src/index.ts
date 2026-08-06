import { Hono } from "hono";
import { auth } from "./lib/auth";

type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const app = new Hono<{ Variables: Variables }>();

// Registered before the session middleware: this handler returns a Response
// without calling next(), so Better Auth's own routes skip the lookup below.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Puts the current user/session on the context for every other route.
app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);
  await next();
});

// Routes must be chained off one another for hc<AppType> to infer them.
const routes = app
  .get("/api/server-info", (c) =>
    c.json({
      runtime:
        typeof Bun !== "undefined"
          ? `Bun ${Bun.version}`
          : `Node ${process.version}`,
      time: new Date().toISOString(),
    }),
  )
  .get("/api/me", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);
    return c.json({ user });
  });

export type AppType = typeof routes;

export default {
  port: Number(process.env.SERVER_PORT ?? 8787),
  fetch: app.fetch,
};
