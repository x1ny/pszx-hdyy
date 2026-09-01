import { hcWithType } from "@repo/server/client-type";

// 纯类型 import 链：apps/server 的任何代码都不会被打进这个包。
// h5 和 API 在生产形态下同源（同一个 Hono 的同一个端口），开发时靠 Vite 的
// /api 代理拉回同源，所以 base URL 永远是当前 origin，不需要 VITE_API_URL。
export const api = hcWithType(window.location.origin, {
  init: { credentials: "include" },
});
