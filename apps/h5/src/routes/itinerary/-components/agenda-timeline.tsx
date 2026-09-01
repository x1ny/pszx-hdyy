import { useMemo } from "react";
import { cn } from "#/shared/lib/utils";
import type { AgendaItem, CarTransfer, Transfer } from "../-data";
import { isNavigable, openNavigation } from "../-utils";
import { BoundCarBlock } from "./bound-car-block";
import { Icon } from "./icon";
import { PillTag } from "./pill-tag";
import { useToast } from "./toast-layer";

/**
 * 我的议程：一条时间轴，左侧时间列 + 竖线 + 节点，右侧是这一场的内容。
 *
 * 三种状态各有一套视觉：已结束整体降到 50% 不透明度并把节点填灰；进行中
 * 套一层主题浅底 + 呼吸描边 + 「进行中」角标；未开始是空心主题色节点。
 */
export function AgendaTimeline({
  agenda,
  transfers,
  onShowSeatMap,
}: {
  agenda: AgendaItem[];
  transfers: Transfer[];
  onShowSeatMap: (item: AgendaItem) => void;
}) {
  const carsById = useMemo(() => {
    const map = new Map<string, CarTransfer>();
    for (const t of transfers) if (t.type === "car") map.set(t.id, t);
    return map;
  }, [transfers]);

  const items = useMemo(
    () =>
      agenda
        .slice()
        .sort((a, b) =>
          `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`),
        ),
    [agenda],
  );

  return (
    <div>
      {items.map((item, i) => (
        <AgendaRow
          key={item.id}
          item={item}
          car={item.carId ? carsById.get(item.carId) : undefined}
          index={i}
          isLast={i === items.length - 1}
          onShowSeatMap={onShowSeatMap}
        />
      ))}
    </div>
  );
}

function AgendaRow({
  item,
  car,
  index,
  isLast,
  onShowSeatMap,
}: {
  item: AgendaItem;
  car?: CarTransfer;
  index: number;
  isLast: boolean;
  onShowSeatMap: (item: AgendaItem) => void;
}) {
  const toast = useToast();
  const ongoing = item.status === "ongoing";
  const finished = item.status === "finished";

  return (
    <div
      className={cn(
        "relative flex animate-slide-in gap-2.5",
        finished && "opacity-50",
        !isLast && "border-line border-b",
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* pt-3 要和右侧内容区的行内边距对齐（见下面那段注释），时间才和标题齐平 */}
      <div className="relative flex w-14 shrink-0 flex-col items-end pt-3 pr-2.5">
        <span
          className={cn(
            "text-time tabular-nums",
            finished ? "text-ink-4" : "text-ink-1",
          )}
        >
          {item.start}
        </span>
        <span className="font-bold text-ink-3 text-xs leading-4 tabular-nums">
          {item.end}
        </span>
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
            "absolute top-[1.125rem] right-[-0.21875rem] h-2 w-2 rounded-full ring-3 ring-surface",
            ongoing && "animate-pulse-ring bg-brand",
            item.status === "upcoming" &&
              "border-[1.5px] border-brand bg-white",
            finished && "bg-ink-4",
          )}
        />
      </div>

      {/* 进行中那张浅底卡要和上下两条分隔线脱开，否则底色会直接糊在线上。
          做法是把行内边距拆成"外边距 + 内边距"，**两者之和必须等于普通行的
          py-3（12px）**——行高不变，左侧时间列和节点圆点才不用跟着挪。 */}
      <div
        className={cn(
          "relative min-w-0 flex-1",
          ongoing ? "my-1.5 rounded-xl bg-brand-soft px-2.5 py-1.5" : "py-3",
        )}
      >
        {ongoing && (
          <>
            <span
              aria-hidden
              className="pointer-events-none -inset-[1.5px] absolute animate-breathe rounded-xl border-[1.5px] border-brand"
            />
            <span className="absolute top-1.5 right-2.5 rounded-full bg-brand-gradient px-2 py-0.5 font-bold text-[0.625rem] text-white leading-4">
              进行中
            </span>
          </>
        )}

        <h3
          className={cn(
            "text-title",
            ongoing && "pr-14",
            finished ? "text-ink-4" : "text-ink-1",
          )}
        >
          {item.title}
        </h3>

        {/* 地点行只负责显示；导航是行尾一颗独立按钮，且只给真需要开车过去的
            地点渲染。整张卡可点会让用户不敢碰。 */}
        <div className="mt-1 flex w-full items-center gap-1">
          <Icon name="map-pin" size={12} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-body text-ink-3">
            {item.venue}
          </span>
          {isNavigable(item.geo) && (
            <button
              type="button"
              onClick={() => {
                if (!isNavigable(item.geo)) return;
                openNavigation(item.geo);
                toast("已为你打开地图");
              }}
              aria-label={`导航到 ${item.venue}`}
              className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-brand before:absolute before:-inset-2 before:content-['']"
            >
              <Icon name="navigation" size={13} />
            </button>
          )}
        </div>

        {/* 只有带分区的座位才画标签和座位图入口——「凭胸卡入场」这种没有
            分区的说明放这里会让人以为能点开看座位。 */}
        {item.zone && (
          <div className="mt-1.5 flex items-center gap-2.5">
            <PillTag
              variant={finished ? "soft" : "solid"}
              className={finished ? "bg-[#f1f2f5] text-ink-4" : undefined}
            >
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

        {item.note && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-note-bg px-2 py-1.5">
            <Icon
              name="megaphone"
              size={12}
              className="mt-[0.1875rem] shrink-0 text-note-icon"
            />
            <span className="min-w-0 text-caption text-note-ink leading-[1.125rem]">
              {item.note}
            </span>
          </div>
        )}

        {car && <BoundCarBlock car={car} />}
      </div>
    </div>
  );
}
