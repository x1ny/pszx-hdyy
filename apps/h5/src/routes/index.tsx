import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

/**
 * 公众端没有"首页"这回事 —— 每个活动一个链接，嘉宾从二维码或转发的链接直接
 * 落到 `/a/<活动id>`。这一页只在有人手输域名时出现，所以它只需要说清"你走错了"。
 *
 * 开发时那句提示没法用（没有链接可点），所以本地额外列出种子活动的直达入口。
 * 用 `import.meta.env.DEV` 而不是查服务端的开关：它在 Vite 构建时就被静态替换
 * 成 false，整块代码连同链接一起被摇掉 —— 镜像里不可能残留一个写死 id 的入口，
 * 而且不需要为此多开一个接口。
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
        <div className="rounded-xl border border-line border-dashed p-3">
          <p className="text-caption text-ink-4">
            开发入口（种子数据，仅本地可见）
          </p>
          <Link
            to="/a/$activityId"
            params={{ activityId: "1" }}
            className="mt-2 flex h-11 items-center justify-center rounded-xl bg-brand-gradient font-bold text-body text-white shadow-brand"
          >
            开幕式暨主论坛（活动 1）
          </Link>
          <p className="mt-2 text-caption text-ink-4">
            手机号 13810000000（王芳）。13810000003 是刻意埋的重号，两个人共用，
            进去只会看到刘洋。
          </p>
        </div>
      )}
    </main>
  );
}
