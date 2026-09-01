import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

// 占位首页。真实的公众端入口（扫码 / 分享链接直达某个页面）还没定，这里先
// 当个页面索引用，方便本地开发时找到已经做好的页面。
function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-6 pb-[env(safe-area-inset-bottom)]">
      <div>
        <h1 className="font-semibold text-2xl text-ink-1">活动服务</h1>
        <p className="mt-1 text-body text-ink-3">
          移动公众端，页面逐个补齐中。
        </p>
      </div>
      <Link
        to="/itinerary"
        className="flex h-12 items-center justify-center rounded-xl bg-brand-gradient font-bold text-body text-white shadow-brand"
      >
        我的专属行程
      </Link>
    </main>
  );
}
