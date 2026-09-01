import { Drawer } from "@base-ui/react/drawer";
import type { ReactNode } from "react";
import { Icon } from "./icon";

/**
 * 从底部推上来的近全屏面板（座位图 / 活动详情共用）。
 *
 * 用 Base UI 的 Drawer 而不是 Dialog：移动端这类面板必须支持下滑关闭，
 * Dialog 明确不做手势（官方文档里就写着要手势就用 Drawer）。焦点陷阱、
 * 页面滚动锁定、Esc 关闭、返回键关闭都由它负责，我们只写皮。
 *
 * 结构上是「头部固定 + 内容区自己滚」：Popup 是 flex 列且 `touch-none`
 * （整块都能拖），Content 拿 `min-h-0 flex-1` 吃掉剩余高度并把 touch 还原成
 * `auto`，否则内容区滚不动。
 */
export function OverlaySheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <Drawer.Portal>
        {/* 蒙层和面板必须显式给 z-index：Portal 挂在 body 末尾，但页面里
            那些 `z-1` / `z-40` 的定位元素（页签滑块、底部操作条）会盖在
            `z-index: auto` 的后来者上面——表现是面板半透明地"漏"出页面内容。 */}
        <Drawer.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-[rgb(16_20_30)] opacity-[calc(0.55*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex touch-none items-end justify-center">
          <Drawer.Popup className="relative z-1 flex max-h-[calc(100dvh-2.25rem)] min-h-[60dvh] w-full max-w-[480px] touch-none flex-col overflow-visible rounded-t-2xl bg-surface text-ink-1 outline-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-12 after:bg-[inherit] after:content-[''] data-ending-style:[transform:translateY(calc(100%+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:[transform:translateY(calc(100%+2px))] data-swiping:select-none">
            <div className="shrink-0 touch-none select-none border-line border-b px-4 pt-2 pb-1">
              {/* 拖拽把手：告诉用户这块可以往下甩 */}
              <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-ink-4/40" />
              <div className="flex h-11 items-center justify-between">
                <Drawer.Title className="text-title">{title}</Drawer.Title>
                <Drawer.Close
                  aria-label="关闭"
                  className="-mr-2.5 flex h-11 w-11 items-center justify-center rounded-full text-ink-2 active:bg-page"
                >
                  <Icon name="x" size={20} />
                </Drawer.Close>
              </div>
            </div>
            <Drawer.Content className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)]">
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
