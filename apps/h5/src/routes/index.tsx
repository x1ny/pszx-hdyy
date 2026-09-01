import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

// 占位首页。真实页面（行程、邀请函、报名等）还没开始做，这里只负责证明
// 路由树、Tailwind 和构建链路是通的。
function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-screen-sm flex-col justify-center gap-3 px-6 pb-[env(safe-area-inset-bottom)]">
      <h1 className="font-semibold text-2xl text-neutral-900">活动服务</h1>
      <p className="text-neutral-500 text-sm leading-relaxed">
        移动公众端已就位，页面还没开始搭。
      </p>
    </main>
  );
}
