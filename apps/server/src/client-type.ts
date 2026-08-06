import { hc } from "hono/client";
import type { AppType } from "./index";

// Pre-computes the RPC client type at compile time instead of letting every
// consumer re-expand the whole route chain — keeps IDE/tsc responsive as
// the route count grows. https://hono.dev/docs/guides/rpc#using-rpc-with-larger-applications
export type Client = ReturnType<typeof hc<AppType>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);
