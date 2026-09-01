import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `styles.css` 的 `@theme` 里自定义的字阶（`--text-title` 等）会生成
 * `text-title` 这类工具类，而 tailwind-merge 只认得 `text-sm` 这种标准尺码，
 * 于是把 `text-title` 归进了「文字颜色」组——`cn("text-time", "text-ink-1")`
 * 会**静默丢掉字号**，只留颜色。这里把字阶名字告诉它，两组才不会互相打架。
 *
 * 加新字阶记得同步这张表，否则又会悄无声息地掉字号（不报错、不告警）。
 */
const FONT_SIZES = [
  "display",
  "title",
  "time",
  "body",
  "caption",
  "tag",
  "eyebrow",
];

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: FONT_SIZES }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
