import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverPort = process.env.SERVER_PORT ?? "8787";
const h5Port = Number(process.env.H5_PORT ?? "3001");

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    host: "localhost",
    port: h5Port,
    strictPort: false,
    // 和 apps/web 一样代理 /api：生产形态下 h5 和 API 由同一个 Hono 在同一个
    // 端口上提供，开发时靠这个代理把两者拉回同源，Cookie 才不用处理跨站。
    proxy: {
      "/api": {
        // 用 127.0.0.1 而不是 localhost：开发时后端只绑回环 IPv4，而 Windows 上
        // localhost 可能先解析成 ::1，那样代理会连不上。
        target: `http://127.0.0.1:${serverPort}`,
      },
    },
  },
  plugins: [
    tailwindcss(),
    // 必须排在 viteReact() 前面，生成的路由文件才会被 React 插件转换。
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    viteReact(),
  ],
});

export default config;
