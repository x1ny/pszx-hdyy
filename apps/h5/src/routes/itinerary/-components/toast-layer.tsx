import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";

/**
 * 顶部居中的轻提示。
 *
 * 用 Base UI 的 Toast 而不是自己写队列：值钱的是 `role="status"` 的播报、
 * 悬停/聚焦时暂停计时、以及滑动消除这些细节，样式反正要自己重写。
 *
 * `useToast()` 必须在 `<ToastLayer>` 内部调用。
 */

/** 复制、导航这类操作的反馈提示，2 秒后自动消失。 */
export function useToast() {
  const manager = Toast.useToastManager();
  return (text: string) => manager.add({ title: text });
}

export function ToastLayer({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider timeout={2000} limit={3}>
      {children}
      <Toast.Portal>
        {/* 跟着 480px 的手机画布走，桌面上不会飘到屏幕角落去 */}
        <Toast.Viewport className="pointer-events-none fixed inset-x-0 top-3 z-70 mx-auto flex w-full max-w-[480px] flex-col items-center gap-2 px-4">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      swipeDirection="up"
      className="pointer-events-auto rounded-full bg-ink-1/88 px-4 py-2 text-body text-white shadow-card backdrop-blur-sm transition-all duration-200 ease-out-expo data-ending-style:-translate-y-2 data-ending-style:opacity-0 data-limited:opacity-0 data-starting-style:-translate-y-3 data-starting-style:opacity-0"
    >
      <Toast.Title className="font-medium" />
    </Toast.Root>
  ));
}
