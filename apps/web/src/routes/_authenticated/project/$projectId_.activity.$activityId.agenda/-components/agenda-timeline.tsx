import { CalendarClockIcon } from "lucide-react";
import { lineLabel, SEGMENT_TYPE_LABELS } from "#/features/agenda/labels";
import type { Segment } from "#/features/agenda/queries";
import type { ResourceDemand } from "#/features/resource/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { cn } from "#/shared/lib/utils.ts";
import type { PlanStatus } from "../../-venue-queries";
import {
  formatTimelineBlockRange,
  TIMELINE_PX_PER_MINUTE,
  type TimelineDay,
} from "../-utils";
import { SegmentConfigIcons } from "./segment-config-icons";

/** 泳道左侧的议程线名称列（w-32）+ 轨道两侧内边距（px-4），px。 */
const LANE_LABEL_PX = 128;
const TRACK_PADDING_PX = 32;

/**
 * 一天的轨道至少要多宽，才能让每分钟占到 TIMELINE_PX_PER_MINUTE 像素。
 *
 * 撑的是轨道不是块：块宽是相对轨道的百分比，轨道变宽，块和刻度线一起等比放大，
 * "宽度 = 时长"这个前提不破。反过来给块加 min-width 就会把它撑过自己的结束
 * 时间去压住后一个块——那是之前时间轴重叠的原因。
 *
 * 取 max()：轨道比容器窄时铺满容器（短的一天在宽屏上照样占满），比容器宽时
 * 交给外层 overflow-x-auto 横向滚动。
 */
const trackMinWidth = (spanMinutes: number) =>
  `max(52rem, ${LANE_LABEL_PX + TRACK_PADDING_PX + Math.ceil(spanMinutes * TIMELINE_PX_PER_MINUTE)}px)`;

/**
 * 议程时间轴：泳道 = 议程线，块按时间比例定位。
 *
 * 不引画布库也不引图表库——泳道 + 绝对定位的块用 div 就够，原型
 * （agenda-timeline.html 的 .timeline-rich / .lane / .event）也是这么画的。
 * 布局全部由 buildAgendaTimeline() 算好，这里只负责渲染。
 */
export function AgendaTimeline({
  days,
  demandsBySegment,
  memberCounts,
  seatingStatusBySegment,
  onSelect,
}: {
  days: TimelineDay[];
  demandsBySegment: ReadonlyMap<number, ResourceDemand[]>;
  memberCounts: ReadonlyMap<number, number>;
  seatingStatusBySegment: ReadonlyMap<number, PlanStatus | null>;
  onSelect: (segment: Segment) => void;
}) {
  if (days.length === 0) {
    return (
      <Empty className="rounded-lg border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClockIcon />
          </EmptyMedia>
          <EmptyTitle>还没有环节</EmptyTitle>
          <EmptyDescription>
            新增环节后，时间轴会按环节的日期、时间和议程线自动生成，不需要
            单独维护。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => (
        <div key={day.key} className="rounded-lg border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="font-medium text-sm">{day.label}</span>
            <span className="text-muted-foreground text-xs">
              {day.lanes.length} 条议程线 · {day.segmentCount} 个环节
              {day.carryOverCount > 0 &&
                ` · 含 ${day.carryOverCount} 个跨日续接`}
              {day.bands.length > 0 && ` · ${day.bands.length} 处并行`}
            </span>
          </div>

          {/* 轨道整体横向滚动：块宽严格按时间比例，短环节靠把整条轨道按当天
              跨度撑宽来保证可读，撑出去的部分在这里滚动——不回头去改单个块的
              宽度，那样刻度线和块的位置就对不上了 */}
          <div className="overflow-x-auto">
            <div
              className="px-4 py-3"
              style={{ minWidth: trackMinWidth(day.spanMinutes) }}
            >
              <div className="flex">
                <div className="w-32 shrink-0" />
                <div className="relative h-5 flex-1">
                  {day.ticks.map((tick) => (
                    <span
                      key={tick.label + tick.leftPct}
                      className="absolute -translate-x-1/2 text-[11px] text-muted-foreground tabular-nums"
                      style={{ left: `${tick.leftPct}%` }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>

              {day.lanes.map((lane) => (
                <div key={lane.line.id} className="flex border-t py-2.5">
                  <div className="w-32 shrink-0 pr-3">
                    <p className="truncate font-medium text-sm">
                      {lineLabel(lane.line)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {lane.line.lineType === "main"
                        ? "主流程"
                        : `并行线 · 排序 ${lane.line.sortOrder}`}
                    </p>
                  </div>

                  <div className="relative flex-1">
                    {/* 并行区块只画在线路真正参与重叠的时间段；没有环节的线路
                        保持空白，不能用日级色带制造出“空环节”。 */}
                    {day.bands
                      .flatMap((band) => band.laneRanges)
                      .filter((range) => range.lineId === lane.line.id)
                      .map((range) => (
                        <div
                          key={`band-${range.leftPct}-${range.widthPct}`}
                          className="pointer-events-none absolute inset-y-0 rounded-sm bg-primary/5"
                          style={{
                            left: `${range.leftPct}%`,
                            width: `${range.widthPct}%`,
                          }}
                        />
                      ))}
                    {day.ticks.map((tick) => (
                      <div
                        key={`grid-${tick.leftPct}`}
                        className="pointer-events-none absolute inset-y-0 w-px bg-border/60"
                        style={{ left: `${tick.leftPct}%` }}
                      />
                    ))}

                    <div className="relative flex flex-col gap-1.5">
                      {lane.rows.map((row) => (
                        <div key={row[0].segment.id} className="relative h-20">
                          {row.map((block) => {
                            const segment = block.segment;
                            return (
                              <button
                                key={segment.id}
                                type="button"
                                onClick={() => onSelect(segment)}
                                aria-label={`${segment.name}，${formatTimelineBlockRange(segment, block)}${block.continuesFromPrevDay ? "，从前一天延续" : ""}`}
                                title={`${segment.name} ${formatTimelineBlockRange(segment, block)} · ${SEGMENT_TYPE_LABELS[segment.segmentType]}${segment.locationText ? ` · ${segment.locationText}` : ""}`}
                                className={cn(
                                  // min-w-2 只是给零时长/几分钟的退化数据留一个
                                  // 能点得到的宽度，量级几像素；真正让短环节可读
                                  // 的是上面撑宽的轨道。@container 让下面的内容
                                  // 按块的实际宽度决定收起哪几行。
                                  "@container absolute inset-y-0 flex min-w-2 cursor-pointer flex-col justify-center overflow-hidden rounded-md border px-1.5 py-1.5 text-left transition-colors",
                                  lane.line.lineType === "main"
                                    ? "border-primary/25 bg-primary/10 hover:bg-primary/15"
                                    : "border-chart-2/25 bg-chart-2/10 hover:bg-chart-2/15",
                                  // 跨日环节被自然日切开：切口那侧不收圆角、加一道粗边，
                                  // 一眼能看出这块是"从昨天接进来 / 还要往明天走"，
                                  // 而不是当天独立的一个完整环节
                                  block.continuesFromPrevDay &&
                                    "rounded-l-none border-l-4",
                                  block.continuesNextDay &&
                                    "rounded-r-none border-r-4",
                                )}
                                style={{
                                  left: `${block.leftPct}%`,
                                  width: `${block.widthPct}%`,
                                }}
                              >
                                {/* 块窄到放不下时逐级收起，而不是塞一堆截断到
                                    看不懂的碎字：名称永远留着，图标是"有没有问题"
                                    的一眼信号所以退得最晚，被收起的内容都在
                                    title / aria-label 里，hover 和点开详情都拿得到。

                                    阈值按 content box 标定——容器查询量的是内容
                                    盒，不含这里的 px-1.5 和 1px 边框，所以块的实
                                    际宽度要比阈值多 14px 才会命中。按每小时 120px
                                    折算：2.5rem→约 27 分钟起显示图标，5.5rem→约
                                    51 分钟起显示时间和类型/地点。 */}
                                <span className="truncate font-medium text-xs leading-4">
                                  {block.continuesFromPrevDay && (
                                    <span className="mr-1 hidden rounded-sm bg-muted px-1 py-px font-normal text-[10px] text-muted-foreground @min-[5.5rem]:inline">
                                      接上日
                                    </span>
                                  )}
                                  {segment.name}
                                </span>
                                {/* 续接日从当天 00:00 展示，环节列表/详情仍保留真实起止。 */}
                                <span className="hidden truncate text-[11px] text-muted-foreground leading-4 tabular-nums @min-[5.5rem]:block">
                                  {formatTimelineBlockRange(segment, block)}
                                </span>
                                <span className="hidden truncate text-[11px] text-muted-foreground leading-4 @min-[5.5rem]:block">
                                  {SEGMENT_TYPE_LABELS[segment.segmentType]}
                                  {segment.locationText &&
                                    ` · ${segment.locationText}`}
                                </span>
                                <div className="mt-0.5 hidden h-4 min-w-0 items-center @min-[2.5rem]:flex">
                                  <SegmentConfigIcons
                                    segment={segment}
                                    memberCount={memberCounts.get(segment.id)}
                                    seatingStatus={seatingStatusBySegment.get(
                                      segment.id,
                                    )}
                                    demands={demandsBySegment.get(segment.id)}
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
