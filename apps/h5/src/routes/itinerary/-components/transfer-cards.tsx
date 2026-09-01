import { useMemo } from "react";
import { cn } from "#/shared/lib/utils";
import type {
  CarTransfer,
  TicketTransfer,
  Transfer,
  TransferType,
} from "../-data";
import { isNavigable } from "../-utils";
import { Copyable } from "./copyable";
import { Icon, type IconName } from "./icon";
import { NavChip } from "./nav-chip";
import { PhoneChip } from "./phone-chip";
import { PillTag } from "./pill-tag";

/**
 * 行程信息：火车 / 飞机 / 用车三类卡片，按出发时间升序。
 *
 * 每类一个语义色（铁路蓝 / 航空紫 / 用车绿），左侧色条 + 图标底色 + 座位
 * 标签共用它，扫一眼就知道是哪种交通方式。
 *
 * 版式是照票根来的：**图标和票号在撕线之上，行程明细在撕线之下**，撕线是
 * 一个真正的兄弟节点、横贯整张卡。别把撕线塞回右边那一列再用负边距拉出来
 * ——那样它的纵向位置由文字列决定，会正好从 36px 的图标身上横穿过去。
 */
const TYPE_META: Record<
  TransferType,
  { icon: IconName; bar: string; badge: string }
> = {
  rail: {
    icon: "train-front",
    bar: "bg-rail",
    badge: "bg-rail-soft text-rail",
  },
  air: { icon: "plane", bar: "bg-air", badge: "bg-air-soft text-air" },
  car: { icon: "car-front", bar: "bg-car", badge: "bg-car-soft text-car" },
};

export function TransferCards({
  transfers,
  inset = false,
}: {
  transfers: Transfer[];
  /** 嵌在「第 N 天」大卡里时用扁平的浅灰子面板，避免卡中卡的层层描边。 */
  inset?: boolean;
}) {
  const sorted = useMemo(
    () =>
      transfers.slice().sort((a, b) => a.sortTime.localeCompare(b.sortTime)),
    [transfers],
  );

  if (sorted.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((t, i) => {
        const meta = TYPE_META[t.type];
        return (
          <div
            key={t.id}
            style={{ animationDelay: `${i * 70}ms` }}
            className={cn(
              "relative animate-rise overflow-hidden border border-line p-3 pl-4",
              // --notch 只在这两个分支里各定义一次：同一个自定义属性写两遍要
              // 靠生成的 CSS 顺序决胜负，class 的先后管不了它。
              inset
                ? "rounded-xl bg-sunken [--notch:var(--color-sunken)]"
                : "rounded-2xl bg-surface shadow-card [--notch:var(--color-surface)]",
            )}
          >
            {/* 左侧语义色条。撕线的缺口会咬穿它，是有意的模切效果。 */}
            <span
              className={cn("absolute inset-y-0 left-0 w-[3px]", meta.bar)}
            />
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.625rem]",
                  meta.badge,
                )}
              >
                <Icon name={meta.icon} size={20} />
              </span>
              {t.type === "car" ? <CarHeader t={t} /> : <TicketHeader t={t} />}
            </div>

            <Perforation />

            {t.type === "car" ? <CarBody t={t} /> : <TicketBody t={t} />}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 撕线之上：票号 / 车次 + 席别，用车则是用途 + 车牌                     */
/* ------------------------------------------------------------------ */

function TicketHeader({ t }: { t: TicketTransfer }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
      <Copyable
        text={t.no}
        className="font-extrabold text-title text-ink-1 tabular-nums"
      >
        {t.no}
      </Copyable>
      {t.seat && (
        <PillTag className={TYPE_META[t.type].badge}>
          <span className="tabular-nums">{t.seat}</span>
        </PillTag>
      )}
    </div>
  );
}

function CarHeader({ t }: { t: CarTransfer }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
      <h3 className="truncate text-title text-ink-1">{t.title}</h3>
      <Copyable
        text={t.plate}
        ariaLabel={`复制车牌 ${t.plate}`}
        className="shrink-0"
      >
        <span className="rounded-md border border-car bg-car-soft px-2 py-0.5 font-extrabold text-body text-car tabular-nums">
          {t.plate}
        </span>
      </Copyable>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 撕线之下：行程明细，占满整张卡的宽度                                 */
/* ------------------------------------------------------------------ */

/** 出发 ─→ 到达，外加登机口 / 检票口提醒。 */
function TicketBody({ t }: { t: TicketTransfer }) {
  const air = t.type === "air";
  const tone = air ? "text-air" : "text-rail";
  const tip = air ? "起飞前 45 分钟停止登机" : "请提前 20 分钟到站";

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="text-time text-ink-1 tabular-nums">{t.depTime}</div>
          <div className="truncate text-body text-ink-3">
            <StationName station={t.depStation} air={air} />
          </div>
        </div>
        <svg
          className={cn("h-4 min-w-8 flex-1", tone)}
          viewBox="0 0 80 12"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            x1="0"
            y1="6"
            x2="70"
            y2="6"
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <polyline
            points="66,2 72,6 66,10"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="min-w-0 text-right">
          <div className="text-time text-ink-1 tabular-nums">{t.arrTime}</div>
          <div className="truncate text-body text-ink-3">
            <StationName station={t.arrStation} air={air} />
          </div>
        </div>
      </div>

      {t.gate && (
        <div className="mt-1 text-caption text-ink-3">
          <span className={cn("font-bold", tone)}>{t.gate}</span>
          {` · ${tip}`}
        </div>
      )}
    </>
  );
}

/** 「北京首都 T2」里的 T2 单独框出来——航站楼走错了比晚点更麻烦。 */
function StationName({ station, air }: { station: string; air: boolean }) {
  const m = air ? /^(.*?)\s*(T\d+)$/.exec(station.trim()) : null;
  if (!m?.[1]) return <>{station}</>;
  return (
    <>
      {m[1]}
      <span className="-translate-y-px ml-1 inline-flex items-center rounded border border-air px-1 font-bold text-[0.625rem] text-air leading-4 tabular-nums">
        {m[2]}
      </span>
    </>
  );
}

function CarBody({ t }: { t: CarTransfer }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink-2">
        <span className="font-bold text-ink-1 tabular-nums">{t.useTime}</span>
        {t.durationMin !== undefined && (
          <span>· 路程预计 {t.durationMin} 分钟</span>
        )}
        <span>· 司机 {t.driver}</span>
        <PhoneChip phone={t.phone} ariaLabel={`拨打司机 ${t.driver} 的电话`} />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-ink-3" />
          <span className="truncate text-body text-ink-3">
            集合：{t.meetPoint}
          </span>
        </div>
        {isNavigable(t.geo) && <NavChip geo={t.geo} tone="car" />}
      </div>
    </>
  );
}

/**
 * 票根撕线：横贯整张卡的虚线 + 两端咬进卡片边缘的半圆缺口（卡片的
 * `overflow-hidden` 把缺口外半边裁掉）。负边距正好抵掉卡片的左右内边距
 * （pl-4 / pr-3），改内边距记得同步改这里。缺口颜色跟着 `--notch` 走，
 * 卡片嵌在哪种底色上就配哪种。
 */
function Perforation() {
  return (
    <div
      aria-hidden
      className="relative -mr-3 -ml-4 my-2 border-ink-4/50 border-t border-dashed"
    >
      <span className="-left-[0.3125rem] -translate-y-1/2 absolute top-1/2 h-2.5 w-2.5 rounded-full bg-[var(--notch)]" />
      <span className="-right-[0.3125rem] -translate-y-1/2 absolute top-1/2 h-2.5 w-2.5 rounded-full bg-[var(--notch)]" />
    </div>
  );
}
