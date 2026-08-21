import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { activityVenueListQueryOptions } from "../-venue-queries";
import { ZONE_PURPOSE_LABELS } from "../-venue-utils";

/**
 * 给一个环节挑一块活动区域来排位。
 *
 * 可选的只有**本活动场地空间里、状态正常的**区域——排位方案指向的是活动区域，
 * 不是场地库的区域（三层模型的中间那层不能跳过，docs/场地排位模块.md §2.1）。
 * 一块区域被多个环节引用是允许的：各环节各自一套座位，天然互不覆盖。
 */
export function SeatingZonePicker({
  open,
  activityId,
  segmentName,
  pending,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  activityId: number;
  segmentName: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (zoneId: number) => void;
}) {
  const listQuery = useQuery({
    ...activityVenueListQueryOptions(activityId),
    enabled: open,
  });

  const venueNameById = new Map(
    (listQuery.data?.venues ?? []).map((v) => [v.id, v.name]),
  );
  const zones = (listQuery.data?.zones ?? []).filter(
    (zone) => zone.status === "active",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader
          title="选择排位区域"
          description={`为「${segmentName}」挑一块活动区域，它的座位会拷贝一份到这个环节的排位方案里。`}
        />
        <DialogBody className="flex flex-col gap-2">
          {listQuery.isLoading ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" />
            </div>
          ) : zones.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground text-sm">
              本活动还没有可用的区域。先去「场地空间」从场地库引用一个场地。
            </p>
          ) : (
            zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                disabled={pending}
                onClick={() => onPick(zone.id)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors",
                  pending
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer hover:bg-muted/60",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">
                    {zone.name}
                  </div>
                  <p className="truncate text-muted-foreground text-xs">
                    {venueNameById.get(zone.activityVenueId) ?? "-"} ·{" "}
                    {ZONE_PURPOSE_LABELS[zone.purpose]}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {zone.capacity} 点位
                </Badge>
              </button>
            ))
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
