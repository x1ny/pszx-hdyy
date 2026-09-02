import { cn } from "#/shared/lib/utils";
import type {
  AgendaItem,
  CarTransfer,
  TicketTransfer,
  Transfer,
} from "../-data";
import { isNavigable } from "../-utils";
import { Copyable } from "./copyable";
import { Icon, type IconName } from "./icon";
import { NavChip } from "./nav-chip";
import { PhoneChip } from "./phone-chip";
import { PillTag } from "./pill-tag";

/** 融合时间轴上的一行。`time`（`HH:mm`）是当天内的排序键。 */
export type DayEntry =
  | { kind: "agenda"; item: AgendaItem; time: string }
  | { kind: "transfer"; transfer: Transfer; time: string; finished: boolean };

const TRANSFER_ICON: Record<Transfer["type"], IconName> = {
  rail: "train-front",
  air: "plane",
  car: "car-front",
};

/**
 * 一天的行程时间轴：**议程和交通混在同一条轴上，按时间先后排**。
 *
 * 上一版把它们分成「我的议程」和「行程信息」两个页签，代价是嘉宾要在两个
 * 列表之间自己对时间——「几点的车去哪一场」得来回翻。现在一趟接驳车就排在
 * 它要送达的那一场前面，一眼看下去就是当天的真实顺序。
 *
 * 因此用车不再折在议程下面：`AgendaItem.carId` 退化成一条纯提示性的关联，
 * 车本身是轴上一个独立的行。
 */
export function DayTimeline({
  entries,
  onShowSeatMap,
}: {
  entries: DayEntry[];
  onShowSeatMap: (item: AgendaItem) => void;
}) {
  return (
    <div>
      {entries.map((e, i) =>
        e.kind === "agenda" ? (
          <AgendaRow
            key={e.item.id}
            item={e.item}
            index={i}
            isLast={i === entries.length - 1}
            onShowSeatMap={onShowSeatMap}
          />
        ) : (
          <TransferRow
            key={e.transfer.id}
            transfer={e.transfer}
            finished={e.finished}
            index={i}
            isLast={i === entries.length - 1}
          />
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 左侧时间列 + 竖线 + 节点：议程行和交通行共用，两种行才对得齐          */
/* ------------------------------------------------------------------ */

function TimeRail({
  top,
  bottom,
  isLast,
  finished,
}: {
  top: string;
  bottom?: string;
  isLast: boolean;
  /** 只有节点圆点表达「已过去」，行内容不降调——降调的信息更难读，而嘉宾
      回看已结束的场次多半正是为了确认细节。 */
  finished: boolean;
}) {
  return (
    <div className="relative flex w-14 shrink-0 flex-col items-end pt-2.5 pr-2.5">
      <span className="text-ink-1 text-time tabular-nums">{top}</span>
      {bottom && (
        <span className="font-bold text-ink-3 text-xs leading-4 tabular-nums">
          {bottom}
        </span>
      )}
      {/* 竖线要一直连到下一行的节点，最后一行才收住 */}
      <span
        className={cn(
          "absolute top-[0.5625rem] right-0 w-px bg-line",
          isLast ? "h-[calc(100%-0.5625rem)]" : "h-[calc(100%+1px)]",
        )}
      />
      {/* 节点套一圈卡片底色的描边，才不会被竖线穿过去 */}
      <span
        className={cn(
          "absolute top-[1.125rem] right-[-0.21875rem] h-2 w-2 rounded-full border-[1.5px] bg-surface ring-3 ring-surface",
          finished ? "border-ink-4" : "border-brand",
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 议程行                                                              */
/* ------------------------------------------------------------------ */

function AgendaRow({
  item,
  index,
  isLast,
  onShowSeatMap,
}: {
  item: AgendaItem;
  index: number;
  isLast: boolean;
  onShowSeatMap: (item: AgendaItem) => void;
}) {
  return (
    <div
      className={cn(
        "relative flex animate-slide-in gap-2.5",
        !isLast && "border-line border-b",
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <TimeRail
        top={item.start}
        bottom={item.end}
        isLast={isLast}
        finished={item.status === "finished"}
      />

      <div className="min-w-0 flex-1 py-2.5">
        <h3 className="text-ink-1 text-title">{item.title}</h3>

        {/* 地点行只负责显示；导航是行尾一颗独立按钮，且只给真需要开车过去的
            地点渲染。整张卡可点会让用户不敢碰。 */}
        <div className="mt-1 flex w-full items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-body text-ink-3">
            {item.venue}
          </span>
          {isNavigable(item.geo) && (
            <NavChip geo={item.geo} ariaLabel={`导航到 ${item.venue}`} />
          )}
        </div>

        {/* 只有带分区的座位才画标签和座位图入口——「凭胸卡入场」这种没有
            分区的说明放这里会让人以为能点开看座位。 */}
        {item.zone && (
          <div className="mt-1.5 flex items-center gap-2.5">
            <PillTag variant="outline">
              <span>{item.zone}</span>
              {item.seat && <span className="tabular-nums">{item.seat}</span>}
            </PillTag>
            <button
              type="button"
              onClick={() => onShowSeatMap(item)}
              aria-label={`查看${item.zone}座位图`}
              className="relative flex items-center gap-0.5 font-bold text-brand text-caption before:absolute before:-inset-x-2 before:-inset-y-3 before:content-['']"
            >
              <Icon name="map" size={12} />
              座位图
            </button>
          </div>
        )}

        {/* 同行人的座位：他们多半没有自己的分享链接，座位号只能挂在拿到链接
            的这位嘉宾身上，所以贴着座位标签下面走一行说明。 */}
        {item.groupSeatNote && (
          <div className="mt-1 flex items-start gap-1 text-caption text-ink-3">
            <Icon
              name="users-round"
              size={12}
              className="mt-[0.125rem] shrink-0"
            />
            <span className="min-w-0">{item.groupSeatNote}</span>
          </div>
        )}

        {/* 需要嘉宾配合的事项。底色改成中性灰、只留红图标承担注意力——整页
            只有主题红一种强调色，再来一套琥珀色就成了第二套语义。 */}
        {item.note && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-page px-2 py-1.5">
            <Icon
              name="megaphone"
              size={12}
              className="mt-[0.1875rem] shrink-0 text-brand"
            />
            <span className="min-w-0 text-caption text-ink-2 leading-[1.125rem]">
              {item.note}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 交通行：和议程行同一套版式，不再是票根卡                             */
/* ------------------------------------------------------------------ */

function TransferRow({
  transfer,
  finished,
  index,
  isLast,
}: {
  transfer: Transfer;
  finished: boolean;
  index: number;
  isLast: boolean;
}) {
  const { top, bottom } = railTimes(transfer);

  return (
    <div
      className={cn(
        "relative flex animate-slide-in gap-2.5",
        !isLast && "border-line border-b",
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <TimeRail top={top} bottom={bottom} isLast={isLast} finished={finished} />

      <div className="min-w-0 flex-1 py-2.5">
        <div className="flex gap-2">
          {/* 图标底色恒定用主题浅底：过没过期由节点圆点表达，这里再灰一层
              会让整行看起来像是禁用了。 */}
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Icon name={TRANSFER_ICON[transfer.type]} size={13} />
          </span>
          <div className="min-w-0 flex-1">
            {transfer.type === "car" ? (
              <CarBody t={transfer} />
            ) : (
              <TicketBody t={transfer} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 时间列的两行。
 *
 * 火车 / 飞机是「出发 / 到达」；用车只有一个发车时刻，把「08:10 发车」拆成
 * 时间和后缀两行，行高才和上面两类对齐。拆不出来就整串当时间。
 */
function railTimes(t: Transfer): { top: string; bottom?: string } {
  if (t.type !== "car") return { top: t.depTime, bottom: t.arrTime };
  const m = /^(\d{1,2}:\d{2})\s*(.*)$/.exec(t.useTime);
  if (!m?.[1]) return { top: t.useTime };
  return { top: m[1], bottom: m[2] || undefined };
}

/**
 * 车次 / 航班号 + 起讫站，就这两行。
 *
 * 席别和登机口**刻意不渲染**：这些嘉宾自己的票面上都有，页面上重复一遍只是
 * 在挤占宽度。字段仍然留在类型里，接后端时不用动数据结构。
 */
function TicketBody({ t }: { t: TicketTransfer }) {
  return (
    <>
      <Copyable
        text={t.no}
        className="font-extrabold text-ink-1 text-title tabular-nums"
      >
        {t.no}
      </Copyable>
      <div className="mt-0.5 text-body text-ink-3">
        {t.depStation} → {t.arrStation}
      </div>
    </>
  );
}

function CarBody({ t }: { t: CarTransfer }) {
  return (
    <>
      <h3 className="text-ink-1 text-title">{t.title}</h3>
      {t.durationMin !== undefined && (
        <div className="mt-0.5 text-caption text-ink-3">
          路程预计 {t.durationMin} 分钟
        </div>
      )}
      {/* 车牌 / 司机 / 电话三样在 375px 上正好排一行；320px 上放不下时让电话
          整颗换行，而不是把司机名字截掉——名字截一半比多占一行难用得多。 */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1 text-body text-ink-2">
        <div className="flex items-center gap-1">
          <Copyable text={t.plate} ariaLabel={`复制车牌 ${t.plate}`}>
            <span className="shrink-0 whitespace-nowrap rounded-md border border-transit bg-transit-soft px-1 py-px font-extrabold text-caption text-transit tabular-nums">
              {t.plate}
            </span>
          </Copyable>
          <span className="whitespace-nowrap">{t.driver}</span>
        </div>
        <PhoneChip phone={t.phone} ariaLabel={`拨打司机 ${t.driver} 的电话`} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-ink-3" />
          <span className="truncate text-caption text-ink-3">
            集合：{t.meetPoint}
          </span>
        </div>
        {isNavigable(t.geo) && <NavChip geo={t.geo} />}
      </div>
    </>
  );
}
