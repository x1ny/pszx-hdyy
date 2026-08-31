import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  Loader2Icon,
  MousePointerClickIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ORGANIZATION_SEAT_PALETTE } from "#/features/venue-editor/canvas/seat-occupant-visual";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/shared/components/ui/alert-dialog.tsx";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "#/shared/components/ui/field.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { cn } from "#/shared/lib/utils.ts";
import {
  organizationSeatingStatsQueryOptions,
  seatingCandidatesQueryOptions,
  unassignOrganizationSeats,
} from "../-venue-queries";

/**
 * 进入画布勾选时带过去的上下文。
 *
 * **没有目标数量、也没有选座方式**——两者都被画布上的自由勾选取代了。
 * `suggestedCount` 只是提示条上那句"该团体还有 N 人未排座"，不构成任何校验。
 */
export type OrganizationSeatBatchSelectionDraft = {
  organizationId: number;
  organizationName: string;
  suggestedCount: number;
};

/**
 * 团体批量占位的**入口**：挑一个团体，看清它的排位现状，然后进画布去勾位置。
 *
 * 这里刻意不承担写入。早先的版本在弹窗里同时提供目标数量、选座方式、预览和
 * 提交，实际用起来是"在弹窗里配置一个自动挑座策略，再去画布验收"——而排位这
 * 件事操作者本来就是看着图挑的，那层配置只是隔在中间。现在写入统一在画布的
 * 勾选模式里完成（见排位页的 `completeOrganizationSeatSelection`），弹窗只剩
 * 选团体和整体解除。
 */
export function OrganizationSeatBatchDialog({
  open,
  planId,
  readOnly,
  onOpenChange,
  onStartSeatSelection,
  onApplied,
}: {
  open: boolean;
  planId: number;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
  /** 选定团体后关闭弹窗，进入画布的团体占位勾选模式。 */
  onStartSeatSelection?: (draft: OrganizationSeatBatchSelectionDraft) => void;
  /** 整体解除后，由页面统一刷新 seating 缓存并清掉画布选择。 */
  onApplied: () => void;
}) {
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);

  const statsQuery = useQuery({
    ...organizationSeatingStatsQueryOptions(planId),
    enabled: open,
  });
  // 汇总数字用 stats；这个列表只负责显示“哪些成员已经按个人排到哪个位置”。
  const candidatesQuery = useQuery({
    ...seatingCandidatesQueryOptions(planId),
    enabled: open && organizationId !== null,
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setOrganizationId(null);
      setReleaseConfirmOpen(false);
    }
    onOpenChange(nextOpen);
  };

  const selectedStat = statsQuery.data?.list.find(
    (item) => item.organizationId === organizationId,
  );

  const releaseMutation = useMutation({
    mutationFn: () =>
      organizationId === null
        ? Promise.reject(new Error("请选择团体"))
        : unassignOrganizationSeats(planId, organizationId),
    onSuccess: (result) => {
      toast.success(`已解除 ${result.seatIds.length} 个团体占位`);
      if (result.wasConfirmed) {
        toast.warning("这份排位已经确认发布过，改动后需要重新确认");
      }
      setReleaseConfirmOpen(false);
      onApplied();
      handleOpenChange(false);
    },
    onError: (error) => {
      setReleaseConfirmOpen(false);
      toast.error(error.message);
    },
  });

  const organizationItems = useMemo(
    () =>
      (statsQuery.data?.list ?? []).map((item) => ({
        value: item.organizationId,
        label: item.name,
      })),
    [statsQuery.data?.list],
  );
  const individualSeats = useMemo(
    () =>
      (candidatesQuery.data?.list ?? []).filter(
        (person) =>
          person.organizationId === organizationId && person.takenSeatLabel,
      ),
    [candidatesQuery.data?.list, organizationId],
  );
  const selectedColor = selectedStat
    ? (ORGANIZATION_SEAT_PALETTE[selectedStat.colorIndex] ??
      ORGANIZATION_SEAT_PALETTE[0])
    : null;

  const startSeatSelection = () => {
    if (!onStartSeatSelection || !selectedStat) return;
    onStartSeatSelection({
      organizationId: selectedStat.organizationId,
      organizationName: selectedStat.name,
      suggestedCount: selectedStat.remainingMemberCount,
    });
    // 走 onOpenChange 而不是 handleOpenChange：不清掉这里选中的团体，下次打开
    // 还停在同一个上面。勾选模式退出后不再回弹窗，这就是唯一的“接着来一次”路径。
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader
            title="团体批量占位"
            description="为选定团体在画布上勾选位置写入团体占位；不会虚构个人，也不会覆盖已经排座的个人或其他团体。"
          />
          <DialogBody className="flex flex-col gap-5">
            {statsQuery.isError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>团体统计加载失败</AlertTitle>
                <AlertDescription>
                  {statsQuery.error.message}
                  <Button
                    className="ml-2"
                    size="sm"
                    variant="outline"
                    onClick={() => statsQuery.refetch()}
                  >
                    重试
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="organization-seat-batch-organization">
                  团体
                </FieldLabel>
                <Select
                  items={organizationItems}
                  value={organizationId}
                  disabled={statsQuery.isLoading || readOnly}
                  onValueChange={(value) =>
                    setOrganizationId(value == null ? null : Number(value))
                  }
                >
                  <SelectTrigger
                    id="organization-seat-batch-organization"
                    className="w-full"
                  >
                    <SelectValue placeholder="选择当前环节范围内的团体" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {organizationItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {!statsQuery.isLoading && organizationItems.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    当前环节范围没有团体，不能创建团体占位。
                  </p>
                ) : null}
              </Field>

              {selectedStat && selectedColor ? (
                <section
                  className="overflow-hidden rounded-xl border"
                  aria-label={`${selectedStat.name} 团体排位统计`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="size-3.5 shrink-0 rounded-full ring-2 ring-background"
                        style={{ backgroundColor: selectedColor.fill }}
                        aria-hidden
                      />
                      <span className="truncate font-semibold text-base">
                        {selectedStat.name}
                      </span>
                    </div>
                    <Badge
                      variant={
                        selectedStat.organizationSeatCount
                          ? "default"
                          : "secondary"
                      }
                      className="tabular-nums"
                    >
                      已有团体占位 {selectedStat.organizationSeatCount}
                    </Badge>
                  </div>

                  {/* 三个数字是这个弹窗真正要传达的东西，所以给足字号和对比度。
                      「已个人排座」和「剩余人数」各自带色，一眼能分出"已经安排
                      好的"和"还要安排的"；总人数是背景信息，保持中性。 */}
                  <dl className="grid grid-cols-3 gap-3 p-4">
                    <Stat
                      value={selectedStat.totalMembers}
                      label="团体总人数"
                      tone="neutral"
                    />
                    <Stat
                      value={selectedStat.assignedPersonCount}
                      label="已个人排座"
                      tone="done"
                    />
                    <Stat
                      value={selectedStat.remainingMemberCount}
                      label="剩余人数"
                      tone="todo"
                    />
                  </dl>

                  <div className="border-t bg-muted/20 px-4 py-3">
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <UsersIcon className="size-4 text-muted-foreground" />
                      已个人排座明细（{selectedStat.assignedPersonCount}）
                    </div>
                    {candidatesQuery.isLoading ? (
                      <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
                        <Loader2Icon className="size-3.5 animate-spin" />
                        正在读取当前环节人员…
                      </div>
                    ) : individualSeats.length ? (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {individualSeats.map((person) => (
                          <li
                            key={person.segmentMemberId}
                            className="rounded-md bg-background px-2 py-1 text-xs ring-1 ring-border"
                          >
                            {person.name}
                            <span className="ml-1 font-medium text-primary tabular-nums">
                              {person.takenSeatLabel}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-muted-foreground text-xs">
                        当前没有可展示的个人排座明细。
                      </p>
                    )}
                    {individualSeats.length <
                    selectedStat.assignedPersonCount ? (
                      <p className="mt-2 text-muted-foreground text-xs">
                        汇总以服务端为准；当前列表只展示已加载候选中的{" "}
                        {individualSeats.length} 条。
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {selectedStat && onStartSeatSelection ? (
                <section className="flex items-start gap-2.5 rounded-lg border border-primary/30 border-dashed bg-primary/5 px-4 py-3">
                  <MousePointerClickIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p className="text-muted-foreground text-xs leading-5">
                    点「开始选座」后回到画布：
                    <span className="font-medium text-foreground">
                      点座位勾选或取消，从空白处拖拽可框选一片
                    </span>
                    。勾中的位置带虚线圈，数量由你定——不排满也能直接提交。
                  </p>
                </section>
              ) : null}
            </FieldGroup>
          </DialogBody>
          <DialogFooter>
            {selectedStat?.organizationSeatCount ? (
              <Button
                type="button"
                variant="destructive"
                disabled={releaseMutation.isPending || readOnly}
                onClick={() => setReleaseConfirmOpen(true)}
              >
                全部解除该团体占位
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={releaseMutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            {onStartSeatSelection ? (
              <Button
                type="button"
                disabled={
                  releaseMutation.isPending || readOnly || !selectedStat
                }
                onClick={startSeatSelection}
              >
                开始选座
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 只在团体还选着的时候挂载。解除成功后 `handleOpenChange` 会把
          organizationId 清掉，若继续挂着，退场动画那一帧会渲染出
          「将解除「」在当前方案中的 0 个团体占位」——一句读起来像出错了的话。 */}
      {selectedStat ? (
        <AlertDialog
          open={releaseConfirmOpen}
          onOpenChange={setReleaseConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>全部解除团体占位？</AlertDialogTitle>
              <AlertDialogDescription>
                将解除「{selectedStat.name}」在当前方案中的{" "}
                {selectedStat.organizationSeatCount}{" "}
                个团体占位。个人分配和其他团体的占位都不会受到影响。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={releaseMutation.isPending}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={releaseMutation.isPending}
                onClick={() => releaseMutation.mutate()}
              >
                {releaseMutation.isPending ? (
                  <Loader2Icon className="animate-spin" />
                ) : null}
                确认全部解除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

/** 三个统计数字共用的卡片。`tone` 决定它读起来是背景信息、已完成还是待办。 */
const STAT_TONE = {
  neutral: {
    box: "border-border bg-muted/40",
    value: "text-foreground",
    label: "text-muted-foreground",
  },
  done: {
    box: "border-success/30 bg-success/10",
    value: "text-success-foreground",
    label: "text-success-foreground/80",
  },
  todo: {
    box: "border-primary/40 bg-primary/10",
    value: "text-primary",
    label: "text-primary/80",
  },
} as const;

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: keyof typeof STAT_TONE;
}) {
  const style = STAT_TONE[tone];
  return (
    <div className={cn("rounded-lg border px-2 py-3 text-center", style.box)}>
      <dt
        className={cn(
          "font-semibold text-2xl leading-none tabular-nums",
          style.value,
        )}
      >
        {value}
      </dt>
      <dd className={cn("mt-2 font-medium text-xs", style.label)}>{label}</dd>
    </div>
  );
}
