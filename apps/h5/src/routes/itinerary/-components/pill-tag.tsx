import type { CSSProperties, ReactNode } from "react";
import { cn } from "#/shared/lib/utils";

/**
 * 座位号、席别这类小标签。
 *
 * `solid` 用主题渐变填充，是「这是你的座位」的强指示；`soft` 是浅底彩字，
 * 给交通类型色和已结束的灰态用（后者由调用方传 style 覆盖）。
 */
export function PillTag({
  children,
  variant = "soft",
  className,
  style,
}: {
  children: ReactNode;
  variant?: "solid" | "soft";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-tag",
        variant === "solid"
          ? "bg-brand-gradient text-white"
          : "bg-brand-soft text-brand",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
