import type { ReactNode } from "react";
import { cn } from "#/shared/lib/utils";
import { copyText } from "../-utils";
import { useToast } from "./toast-layer";

/**
 * 点一下复制车次号 / 车牌号——嘉宾拿到后多半要粘到打车软件或者微信里。
 *
 * 刻意保留 `select-text`：iOS 和微信里长按选中文字是肌肉记忆，别为了做个
 * 复制按钮把它禁掉。触控区靠 `-m-2 p-2` 撑开，视觉尺寸不变。
 */
export function Copyable({
  text,
  ariaLabel,
  className,
  children,
}: {
  text: string;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const toast = useToast();

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? `复制 ${text}`}
      onClick={async () => {
        if (await copyText(text)) toast("已复制");
      }}
      className={cn("-m-2 inline-flex select-text items-center p-2", className)}
    >
      {children}
    </button>
  );
}
