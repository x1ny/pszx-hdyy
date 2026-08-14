import { CalendarClockIcon } from "lucide-react";
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
import type { AgendaLine, Segment } from "../-queries";
import {
  formatSegmentRange,
  lineLabel,
  SEGMENT_STATUS_CHIP,
  SEGMENT_STATUS_LABELS,
  SEGMENT_TYPE_BADGE_CLASS,
  SEGMENT_TYPE_LABELS,
} from "../-utils";

const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

export function SegmentTable({
  segments,
  lines,
  sequenceLabels,
  pendingStatusId,
  onDetail,
  onEdit,
  onToggleStatus,
}: {
  segments: Segment[];
  lines: AgendaLine[];
  sequenceLabels: Map<number, string>;
  pendingStatusId?: number;
  onDetail: (segment: Segment) => void;
  onEdit: (segment: Segment) => void;
  onToggleStatus: (segment: Segment) => void;
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
            <TableHead>状态</TableHead>
            <TableHead className="text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {segments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10}>
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
                      <div className="mt-0.5 flex gap-1">
                        {segment.memberEnabled && (
                          <span className="text-muted-foreground text-xs">
                            人员已开启
                          </span>
                        )}
                        {segment.seatingEnabled && (
                          <span className="text-muted-foreground text-xs">
                            排位已开启
                          </span>
                        )}
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
