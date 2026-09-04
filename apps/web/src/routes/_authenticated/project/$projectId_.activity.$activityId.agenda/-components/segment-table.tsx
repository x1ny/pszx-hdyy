import { CalendarClockIcon } from "lucide-react";
import {
  lineLabel,
  SEGMENT_STATUS_CHIP,
  SEGMENT_STATUS_LABELS,
  SEGMENT_TYPE_BADGE_CLASS,
  SEGMENT_TYPE_LABELS,
} from "#/features/agenda/labels";
import type { AgendaLine, Segment } from "#/features/agenda/queries";
import {
  DEMAND_STATUS_CHIP,
  RESOURCE_TYPE_LABELS,
} from "#/features/resource/labels.ts";
import type { ResourceDemand } from "#/features/resource/queries.ts";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import { cn } from "#/shared/lib/utils.ts";
import type { PlanStatus } from "../../-venue-queries";
import { formatSegmentRange } from "../-utils";
import { SegmentConfigIcons } from "./segment-config-icons";

const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

export function SegmentTable({
  segments,
  lines,
  sequenceLabels,
  demandsBySegment,
  memberCounts,
  seatingStatusBySegment,
  pendingStatusId,
  onDetail,
  onEdit,
  onToggleStatus,
  onManageDemands,
}: {
  segments: Segment[];
  lines: AgendaLine[];
  sequenceLabels: Map<number, string>;
  /** 按环节分组的资源需求项，用来画"资源需求"列的 chip。 */
  demandsBySegment: Map<number, ResourceDemand[]>;
  /** 已开启人员能力的环节，用人数区分未配置与已配置。 */
  memberCounts: ReadonlyMap<number, number>;
  /** 当前有效排位方案的状态；无值即已开启但未配置。 */
  seatingStatusBySegment: ReadonlyMap<number, PlanStatus | null>;
  pendingStatusId?: number;
  onDetail: (segment: Segment) => void;
  onEdit: (segment: Segment) => void;
  onToggleStatus: (segment: Segment) => void;
  onManageDemands: (segment: Segment) => void;
}) {
  const lineById = new Map(lines.map((line) => [line.id, line]));

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <Table>
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16">顺序</TableHead>
            <TableHead className="min-w-40">环节</TableHead>
            <TableHead>议程线</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>日期</TableHead>
            <TableHead>时间</TableHead>
            <TableHead>地点 / 区域</TableHead>
            <TableHead>负责人</TableHead>
            <TableHead className="min-w-32">资源需求</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {segments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11}>
                <Empty className="border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CalendarClockIcon />
                    </EmptyMedia>
                    <EmptyTitle>还没有环节</EmptyTitle>
                    <EmptyDescription>
                      点击右上角"新增环节"，保存后时间轴会自动刷新。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : (
            segments.map((segment) => {
              const line = lineById.get(segment.agendaLineId);
              const voided = segment.status === "voided";
              return (
                <TableRow
                  key={segment.id}
                  className={cn(voided && "text-muted-foreground")}
                >
                  <TableCell className="tabular-nums">
                    {sequenceLabels.get(segment.id) ?? "-"}
                  </TableCell>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      className="cursor-pointer text-primary hover:underline"
                      onClick={() => onDetail(segment)}
                    >
                      {segment.name}
                    </button>
                    {(segment.memberEnabled || segment.seatingEnabled) && (
                      <div className="mt-1">
                        <SegmentConfigIcons
                          segment={segment}
                          memberCount={memberCounts.get(segment.id)}
                          seatingStatus={seatingStatusBySegment.get(segment.id)}
                        />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {line ? lineLabel(line) : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={SEGMENT_TYPE_BADGE_CLASS[segment.segmentType]}
                    >
                      {SEGMENT_TYPE_LABELS[segment.segmentType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {dayFormat.format(new Date(segment.startTime))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatSegmentRange(segment)}
                  </TableCell>
                  <TableCell>{segment.locationText || "-"}</TableCell>
                  <TableCell>{segment.ownerName || "-"}</TableCell>
                  <TableCell>
                    {(() => {
                      const demands = demandsBySegment.get(segment.id) ?? [];
                      if (demands.length === 0) {
                        return (
                          <span className="text-muted-foreground text-xs">
                            无需求
                          </span>
                        );
                      }
                      // chip 的颜色走**派生状态**而不是资源类型色：这一列
                      // 要回答的是"哪些还没配好"，不是"是哪类资源"——类型
                      // 名字本来就写在 chip 上了。
                      return (
                        <div className="flex flex-wrap gap-1">
                          {demands.map((demand) => (
                            <Badge
                              key={demand.id}
                              variant="outline"
                              className={cn(
                                "border text-xs",
                                DEMAND_STATUS_CHIP[demand.status],
                              )}
                            >
                              {RESOURCE_TYPE_LABELS[demand.resourceType]}
                            </Badge>
                          ))}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "border",
                        SEGMENT_STATUS_CHIP[segment.status],
                      )}
                    >
                      {SEGMENT_STATUS_LABELS[segment.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => onDetail(segment)}
                      >
                        详情
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => onEdit(segment)}
                      >
                        修改
                      </Button>
                      {/* 作废环节不给配资源：它已经不在议程上了，配了也不
                          进待办（isOpenTodo 会把它过滤掉） */}
                      {!voided && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => onManageDemands(segment)}
                        >
                          资源需求
                        </Button>
                      )}
                      {/* 只禁用正在提交的那一行，不要整列一起变灰 */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          voided
                            ? "text-primary hover:text-primary"
                            : "text-destructive hover:text-destructive",
                        )}
                        disabled={pendingStatusId === segment.id}
                        onClick={() => onToggleStatus(segment)}
                      >
                        {voided ? "恢复" : "作废"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
