import { CalendarClockIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { cn } from "#/shared/lib/utils.ts";
import type { Segment } from "../-queries";
import {
  formatTime,
  lineLabel,
  SEGMENT_TYPE_LABELS,
  type TimelineDay,
} from "../-utils";

/**
 * 议程时间轴：泳道 = 议程线，块按时间比例定位。
 *
 * 不引画布库也不引图表库——泳道 + 绝对定位的块用 div 就够，原型
 * （agenda-timeline.html 的 .timeline-rich / .lane / .event）也是这么画的。
 * 布局全部由 buildAgendaTimeline() 算好，这里只负责渲染。
 */
export function AgendaTimeline({
  days,
  onSelect,
}: {
  days: TimelineDay[];
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
              {day.lanes.length} 条议程线 ·{" "}
              {day.lanes.reduce(
                (total, lane) =>
                  total +
                  lane.rows.reduce((sum, row) => sum + row.length, 0),
                0,
              )}{" "}
              个环节
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
                        <div
                          key={row[0].segment.id}
                          className="relative h-14"
                        >
                          {row.map((block) => (
                            <button
                              key={block.segment.id}
                              type="button"
                              onClick={() => onSelect(block.segment)}
                              title={`${block.segment.name} ${formatTime(block.segment.startTime)} - ${formatTime(block.segment.endTime)}`}
                              className={cn(
                                "absolute inset-y-0 flex min-w-24 cursor-pointer flex-col justify-center overflow-hidden rounded-md border px-2 text-left transition-colors",
                                lane.line.lineType === "main"
                                  ? "border-primary/25 bg-primary/10 hover:bg-primary/15"
                                  : "border-chart-2/25 bg-chart-2/10 hover:bg-chart-2/15",
                              )}
                              style={{
                                left: `${block.leftPct}%`,
                                width: `${block.widthPct}%`,
                              }}
                            >
                              <span className="truncate font-medium text-xs">
                                {block.segment.name}
                              </span>
                              <span className="truncate text-[11px] text-muted-foreground tabular-nums">
                                {formatTime(block.segment.startTime)} -{" "}
                                {formatTime(block.segment.endTime)}
                                {block.continuesNextDay && " 次日"}
                              </span>
                              <span className="truncate text-[11px] text-muted-foreground">
                                {SEGMENT_TYPE_LABELS[block.segment.segmentType]}
                                {block.segment.locationText &&
                                  ` · ${block.segment.locationText}`}
                              </span>
                            </button>
                          ))}
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
