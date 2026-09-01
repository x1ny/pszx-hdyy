/**
 * Shared footer. Not rendered by the single-page H5 landing (the design uses
 * a fixed StickyShareBar instead); kept as shared infra for future routes.
 */
export default function Footer() {
  return (
    <footer className="border-t border-[var(--line)] bg-white">
      <div className="mx-auto flex max-w-[480px] items-center justify-center px-4 py-4 text-caption text-[var(--ink-3)]">
        行·见 · 活动行程分享
      </div>
    </footer>
  )
}
