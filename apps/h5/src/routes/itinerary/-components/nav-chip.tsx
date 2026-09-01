import type { GeoPoint } from "../-data";
import { openNavigation } from "../-utils";
import { Icon } from "./icon";
import { useToast } from "./toast-layer";

/**
 * 「导航」按钮。视觉高度 36px，靠 `before:` 把点击区撑到 44px——iOS 人机
 * 指南的最小触控尺寸，但不吃布局空间（伪元素不参与流）。
 *
 * `tone` 决定配色：主题色给活动地点用，绿色跟着用车模块的语义色走。
 */
export function NavChip({
  geo,
  label = "导航",
  tone = "brand",
}: {
  geo: GeoPoint;
  label?: string;
  tone?: "brand" | "car";
}) {
  const toast = useToast();

  return (
    <button
      type="button"
      aria-label={`导航到 ${geo.name}`}
      onClick={() => {
        openNavigation(geo);
        toast("已为你打开地图");
      }}
      className={`relative flex h-9 shrink-0 items-center gap-1 rounded-[0.625rem] px-2.5 text-body font-bold transition-transform before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] active:scale-[0.94] ${
        tone === "brand"
          ? "border border-brand/15 bg-brand-soft text-brand"
          : "bg-car-soft text-car"
      }`}
    >
      <Icon name="navigation" size={14} />
      {label}
    </button>
  );
}
