import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverPort = process.env.SERVER_PORT ?? "8787";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 3000,
    // Everything under /api is served by apps/server. Proxying keeps the
    // browser on a single origin, so Better Auth's cookies need no CORS or
    // SameSite handling in development.
    proxy: {
      "/api": {
        target: `http://localhost:${serverPort}`,
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
