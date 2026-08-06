import type { auth } from "./auth";

// The shape the session middleware puts on Hono's context. Any module that
// needs `c.get("user")` imports this — it's the module's public contract,
// not an implementation detail of index.ts.
export type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};
