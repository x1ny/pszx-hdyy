import { hcWithType } from "@repo/server/client-type";

// Type-only import chain: nothing from apps/server is bundled here.
// In dev the base URL is this origin and Vite proxies /api to apps/server;
// set VITE_API_URL when the two are deployed to different domains.
const baseUrl = import.meta.env.VITE_API_URL ?? window.location.origin;

export const api = hcWithType(baseUrl, {
  init: { credentials: "include" },
});
