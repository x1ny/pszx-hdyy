import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { formatDateTime } from "../../-utils";
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
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

export function SegmentDetailDialog({
  segment,
  lines,
  onOpenChange,
  onEdit,
}: {
  segment?: Segment;
  lines: AgendaLine[];
  onOpenChange: (open: boolean) => void;
  onEdit: (segment: Segment) => void;
}) {
  const line = segment
    ? lines.find((candidate) => candidate.id === segment.agendaLineId)
    : undefined;

  return (
    <Dialog open={!!segment} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {segment && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate">{segment.name}</DialogTitle>
              <DialogDescription>
                {dayFormat.format(new Date(segment.startTime))} ·{" "}
                {formatSegmentRange(segment)}
              </DialogDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge
                  variant="outline"
                  className={SEGMENT_TYPE_BADGE_CLASS[segment.segmentType]}
                >
                  {SEGMENT_TYPE_LABELS[segment.segmentType]}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn("border", SEGMENT_STATUS_CHIP[segment.status])}
                >
                  {SEGMENT_STATUS_LABELS[segment.status]}
                </Badge>
                {line && (
                  <Badge variant="outline" className="border-border">
                    {lineLabel(line)}
                  </Badge>
                )}
              </div>
            </DialogHeader>

            <DialogBody className="flex flex-col gap-6">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <Row label="议程线">
                  {line
                    ? `${lineLabel(line)}${line.lineType === "parallel" ? ` · 排序 ${line.sortOrder}` : " · 主流程"}`
                    : "-"}
                </Row>
                <Row label="地点 / 区域">{segment.locationText || "-"}</Row>
                <Row label="负责人">{segment.ownerName || "-"}</Row>
                <Row label="环节人员">
                  {segment.memberEnabled ? "已开启" : "未开启"}
                </Row>
                <Row label="排位">
                  {segment.seatingEnabled ? "已开启 · 未配置" : "未开启"}
                </Row>
                <Row label="最后修改">{formatDateTime(segment.updatedAt)}</Row>
              </dl>

              {segment.description && (
                <div className="flex flex-col gap-1.5">
                  <p className="font-medium text-sm">环节说明</p>
                  <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
                    {segment.description}
                  </p>
                </div>
              )}
            </DialogBody>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button onClick={() => onEdit(segment)}>修改环节</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
