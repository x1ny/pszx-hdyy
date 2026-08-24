import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverPort = process.env.SERVER_PORT ?? "8787";
const webPort = Number(process.env.WEB_PORT ?? "3000");

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    host: "localhost",
    port: webPort,
    strictPort: false,
    // Everything under /api is served by apps/server. Proxying keeps the
    // browser on a single origin, so Better Auth's cookies need no CORS or
    // SameSite handling in development.
    proxy: {
      "/api": {
        // 用 127.0.0.1 而不是 localhost：开发时后端只绑回环 IPv4，而 Windows 上
        // localhost 可能先解析成 ::1，那样代理会连不上。
        target: `http://127.0.0.1:${serverPort}`,
      },
    },
  },
  plugins: [
    devtools(),
    tailwindcss(),
    // Must come before viteReact() so generated routes are transformed.
    // routeFileIgnorePattern 在 tsr.config.json 里也有一份：这里管 dev/build，
    // 那里管 `tsr generate` CLI。两处都要，否则测试文件会被当成一条路由。
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routeFileIgnorePattern: "\\.(test|spec)\\.tsx?$",
    }),
    viteReact(),
  ],
});

export default config;
