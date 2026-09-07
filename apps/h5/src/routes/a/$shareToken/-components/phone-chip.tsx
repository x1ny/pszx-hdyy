import { buildTelHref } from "../-utils";
import { Icon } from "./icon";

/**
 * 一个可拨的号码。
 *
 * 外层 `<a>` 撑到 44px 的触控区，里面那颗药丸只有 28px，靠 `-my-2` 把多出来的
 * 高度还回布局，行高不会被撑开。药丸本身是中性灰（号码是信息，不是重点），只有
 * 听筒图标用主题红 —— 一行里「可以点」的暗示交给那一小块红色就够。
 *
 * **这个组件只渲染真实号码。** 将来若再出现占位电话，**不能**直接把号码丢进来 ——
 * 占位号做成 `tel:` 链接，嘉宾点一下就真打给某个陌生人了，而提示文字拦不住已经
 * 按下去的手指。
 */
export function PhoneChip({
  phone,
  ariaLabel,
}: {
  phone: string;
  ariaLabel?: string;
}) {
  return (
    <a
      href={buildTelHref(phone)}
      aria-label={ariaLabel ?? `拨打电话 ${phone}`}
      className="-my-2 inline-flex min-h-11 shrink-0 items-center transition-transform active:scale-[0.94]"
    >
      <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-transit-soft px-1 text-chip text-transit tabular-nums">
        <Icon name="phone" size={12} className="text-brand" />
        {phone}
      </span>
    </a>
  );
}
