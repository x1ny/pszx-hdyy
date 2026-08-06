import { Hono } from "hono";
import { auth } from "./auth";
import type { Variables } from "./context";

// Official Better Auth + Hono mount pattern — do not change the shape of
// this. https://www.better-auth.com/docs/integrations/hono
//
// Mounted before the session middleware (see index.ts): this handler
// returns a Response without calling next(), so once a request matches
// /api/auth/*, Hono never reaches the session middleware registered after
// it — Better Auth's own routes skip that redundant getSession() lookup.
// That ordering is our own choice, not something the official docs mandate;
// auth.handler() never reads Hono's context, so it's a performance call,
// not a correctness one.
export const authHandler = new Hono<{ Variables: Variables }>().on(
  ["GET", "POST"],
  "/api/auth/*",
  (c) => auth.handler(c.req.raw),
);
