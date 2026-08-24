import { CalendarClockIcon } from "lucide-react";
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
import type { Segment } from "../-queries";
import {
  formatSegmentRange,
  lineLabel,
  SEGMENT_TYPE_LABELS,
  type TimelineDay,
} from "../-utils";
import { SegmentConfigIcons } from "./segment-config-icons";

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

          {/* 轨道整体横向滚动：块宽严格按时间比例，太窄的靠 min-width 撑开，
              撑出去的部分在这里滚动，而不是回头去改百分比把刻度线弄歪 */}
          <div className="overflow-x-auto">
            <div className="min-w-[52rem] px-4 py-3">
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
                    {/* 并行区块：跨议程线的时间重叠，纯视觉提示 */}
                    {day.bands.map((band) => (
                      <div
                        key={`band-${band.leftPct}-${band.widthPct}`}
                        className="pointer-events-none absolute inset-y-0 rounded-sm bg-primary/5"
                        style={{
                          left: `${band.leftPct}%`,
                          width: `${band.widthPct}%`,
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
                                aria-label={`${segment.name}，${formatSegmentRange(segment)}${block.continuesFromPrevDay ? "，从前一天延续" : ""}`}
                                title={`${segment.name} ${formatSegmentRange(segment)}`}
                                className={cn(
                                  "absolute inset-y-0 flex min-w-28 cursor-pointer flex-col justify-center overflow-hidden rounded-md border px-1.5 py-1.5 text-left transition-colors",
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
                                <span className="truncate font-medium text-xs leading-4">
                                  {block.continuesFromPrevDay && (
                                    <span className="mr-1 rounded-sm bg-muted px-1 py-px font-normal text-[10px] text-muted-foreground">
                                      接上日
                                    </span>
                                  )}
                                  {segment.name}
                                </span>
                                {/* 始终写环节的真实起止：跨日时 formatSegmentRange
                                    会带上结束日期，所以每一天看到的时间信息一致，
                                    也不会再出现跨两天却标"次日"的错 */}
                                <span className="truncate text-[11px] text-muted-foreground leading-4 tabular-nums">
                                  {formatSegmentRange(segment)}
                                </span>
                                <span className="truncate text-[11px] text-muted-foreground leading-4">
                                  {SEGMENT_TYPE_LABELS[segment.segmentType]}
                                  {segment.locationText &&
                                    ` · ${segment.locationText}`}
                                </span>
                                <div className="mt-0.5 flex h-4 min-w-0 items-center">
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
