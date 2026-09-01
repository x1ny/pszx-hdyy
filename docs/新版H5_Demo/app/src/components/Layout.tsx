import type { ReactNode } from 'react'

/**
 * App shell. Uses the CHILDREN pattern — App.tsx must render
 * `<Layout><Routes>…</Routes></Layout>` (never mix with <Outlet/>).
 *
 * The H5 design calls for no conventional navbar/footer, so Layout only
 * provides the centered 480px page container. If a route later opts into
 * chrome, render <Navbar/> here and keep its `sticky top-0` flow contract
 * (no per-page offset bookkeeping).
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-viewport mx-auto w-full max-w-[480px] bg-[var(--bg-page)]">
      <main className="app-viewport">{children}</main>
    </div>
  )
}
