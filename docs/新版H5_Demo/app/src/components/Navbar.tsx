import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/**
 * Shared navbar for multi-route apps. This product is a single-page H5 with
 * only the `/` route, so the landing page does NOT render a conventional
 * navbar (see itinerary.md — no desktop chrome). Kept as shared infra with
 * the sticky positioning contract from react-dev.md.
 */
export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--line)] bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[393px] items-center justify-between px-4">
        <Link to="/" className="text-h-section text-[var(--ink-1)]">
          行·见 行程分享
        </Link>
        <nav className="flex items-center gap-4 text-body">
          <Link to="/" className={cn('text-[var(--ink-2)] hover:text-[var(--theme-primary)]')}>
            我的行程
          </Link>
        </nav>
      </div>
    </header>
  )
}
