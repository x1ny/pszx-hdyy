import type { CSSProperties, ReactNode } from "react";
import { cn } from "#/shared/lib/utils";

/**
 * 座位号、席别这类小标签。
 *
 * `outline` 是座位标签的默认长相：白底 + 主题色描边和字。上一版用实心渐变
 * 填充，一屏里五六个座位标签一起亮着，主题色就不再是「重点」的信号了。
 * `solid` 留给真正唯一的强指示（座位图上「您在这里」），`soft` 给浅底彩字。
 */
export function PillTag({
  children,
  variant = "soft",
  className,
  style,
}: {
  children: ReactNode;
  variant?: "solid" | "soft" | "outline";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-tag",
        variant === "solid" && "bg-brand-gradient text-white",
        variant === "outline" && "border border-brand bg-surface text-brand",
        variant === "soft" && "bg-brand-soft text-brand",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
