import type { GeoPoint } from "../-data";
import { openNavigation } from "../-utils";
import { Icon } from "./icon";
import { useToast } from "./toast-layer";

/**
 * 「导航」按钮。视觉高度 28px，靠 `before:` 把点击区撑到 44px——iOS 人机
 * 指南的最小触控尺寸，但不吃布局空间（伪元素不参与流）。
 *
 * 全站只有这一种长相：议程的场地行和用车的集合点用的是同一颗按钮。上一版
 * 给用车配了绿色变体，交通色中性化之后没有第二种配色了，能操作的东西一律
 * 是主题红。
 */
export function NavChip({
  geo,
  label = "导航",
  ariaLabel,
}: {
  geo: GeoPoint;
  label?: string;
  ariaLabel?: string;
}) {
  const toast = useToast();

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? `导航到 ${geo.name}`}
      onClick={() => {
        openNavigation(geo);
        toast("已为你打开地图");
      }}
      className="-my-2 relative flex min-h-11 shrink-0 items-center transition-transform before:absolute before:-inset-x-1 before:content-[''] active:scale-[0.94]"
    >
      <span className="flex h-7 items-center gap-1 rounded-lg bg-brand-soft px-2 text-brand text-chip">
        <Icon name="navigation" size={12} />
        {label}
      </span>
    </button>
  );
}
