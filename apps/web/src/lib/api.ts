import type { AppType } from "@repo/server";
import { hc } from "hono/client";

// Type-only import of the Hono app: request/response types are inferred from
// the server's route definitions, and nothing from apps/server is bundled.
// In dev the base URL is this origin and Vite proxies /api to apps/server;
// set VITE_API_URL when the two are deployed to different domains.
const baseUrl = import.meta.env.VITE_API_URL ?? window.location.origin;

export const api = hc<AppType>(baseUrl, {
  init: { credentials: "include" },
});
