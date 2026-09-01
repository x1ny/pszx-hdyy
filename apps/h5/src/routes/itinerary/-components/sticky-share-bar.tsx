import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import type { EventInfo } from "../-data";
import { addToCalendar, shareItinerary } from "../-utils";
import { Icon } from "./icon";
import { useToast } from "./toast-layer";

/**
 * 底部固定操作条：添加到日历（次要）+ 转发给同行人（主要）。
 *
 * 永远脱离文档流，页面内容靠自己的底部内边距让位（见页面组件）。微信里
 * 没有 Web Share API，也没法用 JS 触发转发，只能弹一层引导蒙层指向右上角
 * 的「···」——这是所有微信内 H5 分享的标准做法。
 */
export function StickyShareBar({ event }: { event: EventInfo }) {
  const toast = useToast();
  const [wechatGuide, setWechatGuide] = useState(false);

  return (
    <>
      <section
        aria-label="分享与日历操作"
        className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-line border-t bg-white/92 pb-safe backdrop-blur-md"
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <button
            type="button"
            onClick={async () => {
              const result = await addToCalendar(event);
              toast(
                result === "downloaded"
                  ? "已保存日历文件"
                  : "已复制时间信息，请粘贴到日历",
              );
            }}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-white font-bold text-body text-ink-1 transition-transform active:scale-[0.96]"
          >
            <Icon name="calendar-plus" size={16} className="text-brand" />
            添加到日历
          </button>
          <button
            type="button"
            onClick={async () => {
              const result = await shareItinerary({
                title: event.title,
                text: `${event.dateText} ${event.timeRange} · ${event.city}${event.venue}`,
                url: window.location.href,
              });
              if (result === "wechat-guide") setWechatGuide(true);
              else if (result === "copied")
                toast("链接已复制，去粘贴给同行人吧");
              else if (result === "failed") toast("分享失败，请稍后重试");
            }}
            className="flex h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-brand-gradient font-bold text-body text-white shadow-brand transition-transform active:scale-[0.96]"
          >
            <Icon name="share-2" size={16} />
            转发给同行人
          </button>
        </div>
      </section>

      <Dialog.Root open={wechatGuide} onOpenChange={setWechatGuide}>
        <Dialog.Portal>
          {/* z-index 要压过上面那条 z-40 的操作条，理由同 overlay-sheet.tsx */}
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/70 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup className="fixed inset-0 z-50 mx-auto flex max-w-[480px] flex-col items-end px-6 pt-4 outline-none">
            <Dialog.Close
              aria-label="关闭引导"
              className="absolute top-3 right-3 flex h-11 w-11 items-center justify-center rounded-full text-white"
            >
              <Icon name="x" size={20} />
            </Dialog.Close>
            {/* 一条指向右上角「···」的虚线箭头 */}
            <svg
              width="56"
              height="56"
              viewBox="0 0 56 56"
              fill="none"
              aria-hidden="true"
              className="mt-11"
            >
              <path
                d="M10 48 C 26 40, 40 26, 46 8"
                stroke="#fff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="1 7"
              />
              <path
                d="M38 8 h8 v8"
                stroke="#fff"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <div className="mt-2 w-full rounded-xl bg-white p-4 text-center">
              <Dialog.Title className="text-title">
                点击右上角 ··· 发送给朋友
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-body text-ink-3">
                把这份行程转发给同行人
              </Dialog.Description>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
