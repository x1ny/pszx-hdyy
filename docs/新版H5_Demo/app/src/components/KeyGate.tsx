import { useState } from 'react'
import { motion } from 'framer-motion'
import { DEMO_ACCESS_KEY, verifyAccessKey } from '@/lib/itinerary-api'
import { Icon } from '@/components/shared'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

/**
 * Access-key gate. The shared link is no longer enough on its own — the
 * guest enters the dedicated key from the organizer to unlock their
 * itinerary. Success is persisted (sessionStorage) by the caller.
 */
export default function KeyGate({ onUnlock }: { onUnlock: () => void }) {
  const [key, setKey] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim() || verifying) return
    setVerifying(true)
    setFailed(false)
    const ok = await verifyAccessKey(key)
    setVerifying(false)
    if (ok) {
      onUnlock()
    } else {
      setFailed(true)
    }
  }

  return (
    <div className="app-viewport flex flex-col items-center justify-center bg-[var(--bg-card)] px-8">
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="flex w-full flex-col items-center text-center"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--theme-soft)] text-[var(--theme-primary)]">
          <Icon name="lock-keyhole" size={24} />
        </span>
        <h1 className="mt-4 text-[17px] font-bold leading-6 text-[var(--ink-1)]">
          请输入手机号码
        </h1>
        <p className="mt-1.5 text-body leading-5 text-[var(--ink-3)]">
          输入主办方登记的手机号码
          <br />
          即可查看你的专属行程
        </p>

        <form onSubmit={submit} className="mt-6 w-full">
          <motion.div
            animate={failed ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={key}
              onChange={(e) => {
                setKey(e.target.value.replace(/\D/g, ''))
                setFailed(false)
              }}
              placeholder="请输入手机号码"
              aria-label="专属密钥"
              aria-invalid={failed}
              autoFocus
              autoComplete="off"
              className={cn(
                'h-12 w-full rounded-xl border bg-white px-4 text-center font-num text-[15px] font-bold tracking-[0.08em] text-[var(--ink-1)] outline-none transition-colors placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--ink-4)]',
                failed
                  ? 'border-[var(--theme-primary)]'
                  : 'border-[var(--line)] focus:border-[var(--theme-primary)]',
              )}
            />
          </motion.div>
          <div className="mt-1.5 h-4 text-caption text-[var(--theme-primary)]">
            {failed && '手机号不正确，请核对后重试'}
          </div>
          <motion.button
            type="submit"
            disabled={!key.trim() || verifying}
            whileTap={{ scale: 0.97 }}
            className="shadow-share bg-theme-gradient mt-1 h-11 w-full rounded-xl text-body font-bold text-white disabled:opacity-40"
          >
            {verifying ? '验证中…' : '查看我的行程'}
          </motion.button>
        </form>

        {/* demo affordance — removed in production */}
        <p className="mt-5 text-caption text-[var(--ink-4)]">
          演示手机号：<span className="font-num font-bold">{DEMO_ACCESS_KEY}</span>
        </p>
      </motion.div>
    </div>
  )
}
