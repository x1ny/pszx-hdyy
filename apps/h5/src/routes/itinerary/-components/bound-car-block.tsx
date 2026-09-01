import { Collapsible } from "@base-ui/react/collapsible";
import type { CarTransfer } from "../-data";
import { isNavigable } from "../-utils";
import { Copyable } from "./copyable";
import { Icon } from "./icon";
import { NavChip } from "./nav-chip";
import { PhoneChip } from "./phone-chip";

/**
 * 挂在议程下方的用车安排，默认折叠。
 *
 * 用车既属于议程（几点从哪出发去这一场）又属于行程（是一趟车），两边都放
 * 会重复。定的口径是：绑定了议程的车折在议程下面，火车和飞机只在「行程
 * 信息」里出现。
 */
export function BoundCarBlock({ car }: { car: CarTransfer }) {
  return (
    <Collapsible.Root className="mt-2 rounded-xl border border-line bg-sunken">
      <Collapsible.Trigger className="group flex min-h-11 w-full items-center gap-2 px-2.5 py-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-car-soft text-car">
          <Icon name="car-front" size={14} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-bold text-body text-ink-1">
            用车安排
            <span className="font-extrabold text-car tabular-nums">
              {" "}
              {car.useTime}
            </span>
          </span>
          {/* 路程时长单独占一行 caption：塞进标题行在 375px 上会被截断 */}
          {car.durationMin !== undefined && (
            <span className="block text-caption text-ink-3 leading-4">
              路程预计 {car.durationMin} 分钟
            </span>
          )}
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className="shrink-0 text-ink-3 transition-transform duration-200 group-data-panel-open:rotate-180"
        />
      </Collapsible.Trigger>

      <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-250 ease-out-expo data-ending-style:h-0 data-starting-style:h-0">
        <div className="border-line border-t border-dashed px-2.5 pt-2 pb-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-bold text-body text-ink-1">
              {car.title}
            </span>
            <Copyable
              text={car.plate}
              ariaLabel={`复制车牌 ${car.plate}`}
              className="shrink-0"
            >
              <span className="rounded-md border border-car bg-car-soft px-2 py-0.5 font-extrabold text-body text-car tabular-nums">
                {car.plate}
              </span>
            </Copyable>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink-2">
            <span>司机 {car.driver}</span>
            <PhoneChip
              phone={car.phone}
              ariaLabel={`拨打司机 ${car.driver} 的电话`}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <Icon name="map-pin" size={12} className="shrink-0 text-ink-3" />
              <span className="truncate text-body text-ink-3">
                集合：{car.meetPoint}
              </span>
            </div>
            {isNavigable(car.geo) && <NavChip geo={car.geo} tone="car" />}
          </div>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
