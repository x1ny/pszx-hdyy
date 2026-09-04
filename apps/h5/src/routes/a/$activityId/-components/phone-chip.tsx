import { buildTelHref } from "../-utils";
import { Icon } from "./icon";
import { PlaceholderMark } from "./placeholder-mark";

/**
 * 电话。**真号可拨，占位号只显示。**
 *
 * 这一页上同时有两类电话：司机电话是 `activity_resource.driver_phone`，真数据；
 * 现场联系人是占位（库里根本没有联系人电话列）。占位号做成 `tel:` 链接的话，
 * 嘉宾点一下就真的打给某个陌生人 —— 而「（占位数据）」四个字拦不住已经按下去的
 * 手指。所以这里按 `placeholder` 分成两种渲染，调用方必须显式传。
 *
 * 真号那条：外层 `<a>` 撑到 44px 的触控区，里面那颗药丸只有 28px，靠 `-my-2`
 * 把多出来的高度还回布局，行高不会被撑开。药丸本身是中性灰（号码是信息，不是
 * 重点），只有听筒图标用主题红 —— 一行里「可以点」的暗示交给那一小块红色就够。
 */
export function PhoneChip({
  phone,
  ariaLabel,
  placeholder = false,
}: {
  phone: string;
  ariaLabel?: string;
  placeholder?: boolean;
}) {
  const pill = (
    <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-transit-soft px-1 text-chip text-transit tabular-nums">
      <Icon
        name="phone"
        size={12}
        className={placeholder ? "text-ink-4" : "text-brand"}
      />
      {phone}
    </span>
  );

  if (placeholder) {
    return (
      <span className="inline-flex shrink-0 items-center">
        {pill}
        <PlaceholderMark />
      </span>
    );
  }

  return (
    <a
      href={buildTelHref(phone)}
      aria-label={ariaLabel ?? `拨打电话 ${phone}`}
      className="-my-2 inline-flex min-h-11 shrink-0 items-center transition-transform active:scale-[0.94]"
    >
      {pill}
    </a>
  );
}
