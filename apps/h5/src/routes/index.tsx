import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

/**
 * 公众端没有"首页"这回事 —— 每个活动一个链接，嘉宾从二维码或转发的链接直接
 * 落到 `/a/<分享标识>`。这一页只在有人手输域名时出现，所以它只需要说清"你走错了"。
 *
 * 开发也不再放写死 id 的直达入口：种子数据和存量数据一样，首次从管理端点击
 * 「分享行程链接」才生成 token。这样本地能真实覆盖这条懒生成链路，镜像里也不会
 * 残留可枚举的活动 id。
 */
function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-6 pb-[env(safe-area-inset-bottom)]">
      <div>
        <h1 className="font-semibold text-2xl text-ink-1">活动服务</h1>
        <p className="mt-1 text-body text-ink-3">
          请通过主办方提供的链接或二维码进入活动页面。
        </p>
      </div>

      {import.meta.env.DEV && (
        <p className="rounded-xl border border-line border-dashed p-3 text-caption text-ink-4">
          本地调试请从管理端活动概览点击「分享行程链接」，再打开生成的地址。
        </p>
      )}
    </main>
  );
}
