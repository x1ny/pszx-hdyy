import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { EventInfo } from '@/types/itinerary'
import { addToCalendar, shareItinerary } from '@/lib/actions'
import { Icon } from '@/components/shared'
import { useToast } from '@/lib/toast-context'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

/**
 * Bottom fixed share bar (safe-area aware, never in document flow):
 * 添加到日历 (secondary) + 转发给同行人 (primary, theme gradient).
 * Wired through the existing actions.ts helpers — WeChat falls back to an
 * in-page guide mask, unsupported browsers fall back to clipboard + toast.
 */
export default function StickyShareBar({ event }: { event: EventInfo }) {
  const { show } = useToast()
  const [wechatGuide, setWechatGuide] = useState(false)
  const reduceMotion = useReducedMotion()

  const handleCalendar = async () => {
    const result = await addToCalendar(event)
    show(result === 'downloaded' ? '已保存日历文件' : '已复制时间信息，请粘贴到日历')
  }

  const handleShare = async () => {
    const result = await shareItinerary({
      title: event.title,
      text: `${event.dateText} ${event.timeRange} · ${event.city}${event.venue}`,
      url: window.location.href,
    })
    if (result === 'wechat-guide') setWechatGuide(true)
    else if (result === 'copied') show('链接已复制，去粘贴给同行人吧')
    else if (result === 'failed') show('分享失败，请稍后重试')
  }

  // ESC closes the WeChat guide mask.
  useEffect(() => {
    if (!wechatGuide) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWechatGuide(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wechatGuide])

  return (
    <>
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { y: 72, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={reduceMotion ? { duration: 0.15 } : { duration: 0.4, delay: 0.5, ease: EASE }}
        role="region"
        aria-label="分享与日历操作"
        className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-[var(--line)] backdrop-blur-md"
        style={{
          // WeChat lacks backdrop-filter: near-solid fallback keeps contrast.
          background: 'rgba(255,255,255,0.92)',
        }}
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={handleCalendar}
            aria-label="添加到日历"
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-white text-body font-bold text-[var(--ink-1)]"
          >
            <Icon name="calendar-plus" size={16} className="text-[var(--theme-primary)]" />
            添加到日历
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={handleShare}
            aria-label="转发给同行人"
            className="shadow-share bg-theme-gradient flex h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-xl text-body font-bold text-white"
          >
            <Icon name="share-2" size={16} />
            转发给同行人
          </motion.button>
        </div>
        <div className="pb-safe" />
      </motion.div>

      {/* WeChat share guide mask */}
      <AnimatePresence>
        {wechatGuide && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.1 : 0.2 }}
            onClick={() => setWechatGuide(false)}
            role="dialog"
            aria-modal="true"
            aria-label="微信转发引导"
            className="fixed inset-0 z-[70] bg-black/70"
          >
            <div className="relative mx-auto flex h-full max-w-[480px] flex-col items-end px-6 pt-4">
              <button
                type="button"
                aria-label="关闭引导"
                onClick={() => setWechatGuide(false)}
                className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-white"
              >
                <Icon name="x" size={20} />
              </button>
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden className="mt-11">
                <path
                  d="M10 48 C 26 40, 40 26, 46 8"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="1 7"
                />
                <path d="M38 8 h8 v8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              <div className="mt-2 w-full rounded-xl bg-white p-4 text-center">
                <p className="text-card-title text-[var(--ink-1)]">点击右上角 ··· 发送给朋友</p>
                <p className="mt-1 text-body text-[var(--ink-3)]">
                  把这份行程转发给同行人（点击任意处关闭）
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
