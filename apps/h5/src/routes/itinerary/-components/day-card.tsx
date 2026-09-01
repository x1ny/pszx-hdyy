import { Collapsible } from "@base-ui/react/collapsible";
import type { ReactNode } from "react";
import { cn } from "#/shared/lib/utils";
import { dayOrdinal, parseDay } from "../-utils";
import { Icon } from "./icon";

/**
 * 多天活动里的「第 N 天」大卡：日期磁贴 + 天数 + 条目数 + 折叠箭头。
 *
 * 已经过去的那天默认折叠并整体降调（灰磁贴 + 「已结束」），当天和往后默认
 * 展开——嘉宾打开页面十有八九是想看今天和明天。
 */
export function DayCard({
  index,
  day,
  count,
  isCurrent,
  isPast,
  children,
}: {
  index: number;
  day: string;
  count: number;
  isCurrent: boolean;
  isPast: boolean;
  children: ReactNode;
}) {
  const parts = parseDay(day);

  return (
    <Collapsible.Root
      defaultOpen={!isPast}
      className="mb-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
      render={<section aria-label={`第${dayOrdinal(index)}天 ${day}`} />}
    >
      <Collapsible.Trigger className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        <span
          aria-hidden
          className={cn(
            "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl",
            isPast ? "bg-[#f1f2f5] text-ink-4" : "bg-brand-soft text-brand",
          )}
        >
          <span className="font-extrabold text-[1rem] leading-5 tabular-nums">
            {parts?.day ?? "–"}
          </span>
          <span className="font-bold text-[0.5625rem] leading-3 opacity-70">
            {parts?.weekday ?? ""}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "font-bold text-body",
                isPast ? "text-ink-3" : "text-ink-1",
              )}
            >
              第{dayOrdinal(index)}天
            </span>
            {isCurrent && (
              <span className="rounded-full bg-brand-gradient px-1.5 py-px font-bold text-[0.625rem] text-white leading-4">
                今天
              </span>
            )}
            {isPast && <span className="text-caption text-ink-4">已结束</span>}
          </span>
          <span className="block text-caption text-ink-3">
            {parts ? `${parts.month}月${parts.day}日 ${parts.weekday}` : day}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 font-bold text-caption text-ink-3">
          <span className="tabular-nums">{count}</span> 项
          <Icon
            name="chevron-down"
            size={14}
            className="transition-transform duration-200 group-data-panel-open:rotate-180"
          />
        </span>
      </Collapsible.Trigger>

      <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-250 ease-out-expo data-ending-style:h-0 data-starting-style:h-0">
        <div className="border-line border-t px-2.5 py-1.5">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
