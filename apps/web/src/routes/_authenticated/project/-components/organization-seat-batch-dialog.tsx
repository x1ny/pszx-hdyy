import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  Loader2Icon,
  RefreshCwIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import {
  assignOrganizationSeatBatch,
  type OrganizationSeatBatchInput,
  type OrganizationSeatBatchPreview,
  organizationSeatingStatsQueryOptions,
  previewOrganizationSeatBatch,
  seatingCandidatesQueryOptions,
  unassignOrganizationSeats,
} from "../-venue-queries";

export type OrganizationSeatBatchTargetMode = "remaining" | "custom";

export type OrganizationSeatBatchSelectionMode = "continuous" | "marquee";

export type OrganizationSeatBatchSelectionDraft = {
  organizationId: number;
  organizationName: string;
  targetMode: OrganizationSeatBatchTargetMode;
  customTarget: string;
  targetCount: number;
  mode: OrganizationSeatBatchSelectionMode;
};

type SelectedSeat = {
  id: number;
  label: string;
};

type PreviewState = {
  key: string;
  data: OrganizationSeatBatchPreview;
};

type MessageState = {
  key: string;
  text: string;
};

type BatchRequest = {
  input: OrganizationSeatBatchInput;
  key: string;
};

const TARGET_MODE_LABELS: Record<OrganizationSeatBatchTargetMode, string> = {
  remaining: "按剩余人数",
  custom: "自定义数量",
};

const SELECTION_MODE_LABELS: Record<
  OrganizationSeatBatchSelectionMode,
  string
> = {
  continuous: "连续选座",
  marquee: "框选区域",
};

const SKIP_REASON_LABELS = {
  notFound: "位置不存在",
  removed: "位置已移除",
  disabled: "本环节已停用",
  occupied: "已被占用",
} as const;

/**
 * 团体占位是独立于“给一个座位排一个人”的批量路径。
 *
 * 这里只消费画布当前返回的 `selection.seatIds` 对应的有序位置；不会自行改成
 * 连续范围或框选排序。后续可以增强选择手势，但这份批量写入契约不变。
 */
export function OrganizationSeatBatchDialog({
  open,
  planId,
  selectedSeats,
  readOnly,
  selectionDraft,
  onOpenChange,
  onDismiss,
  onStartSeatSelection,
  onApplied,
}: {
  open: boolean;
  planId: number;
  selectedSeats: readonly SelectedSeat[];
  readOnly: boolean;
  /** 从画布选座会话返回时，用这份草稿还原团体、数量和选择方式。 */
  selectionDraft?: OrganizationSeatBatchSelectionDraft | null;
  onOpenChange: (open: boolean) => void;
  /** 正常关闭弹窗时清掉页面持有的草稿；进入画布选座时不会触发。 */
  onDismiss?: () => void;
  /** 选择团体和目标数量后，暂时关闭弹窗并进入画布选座模式。 */
  onStartSeatSelection?: (draft: OrganizationSeatBatchSelectionDraft) => void;
  /** 成功写入或整体解除后，由页面统一刷新 seating 缓存并清掉画布选择。 */
  onApplied: () => void;
}) {
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [targetMode, setTargetMode] =
    useState<OrganizationSeatBatchTargetMode>("remaining");
  const [customTarget, setCustomTarget] = useState("");
  const [selectionMode, setSelectionMode] =
    useState<OrganizationSeatBatchSelectionMode>("continuous");
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [messageState, setMessageState] = useState<MessageState | null>(null);
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
  useEffect(() => {
    if (!open || !selectionDraft) return;
    setOrganizationId(selectionDraft.organizationId);
    setTargetMode(selectionDraft.targetMode);
    setCustomTarget(selectionDraft.customTarget);
    setSelectionMode(selectionDraft.mode);
    setPreviewState(null);
    setMessageState(null);
  }, [open, selectionDraft]);

  const resetDialog = () => {
    setOrganizationId(null);
    setTargetMode("remaining");
    setCustomTarget("");
    setSelectionMode("continuous");
    setPreviewState(null);
    setMessageState(null);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetDialog();
      onDismiss?.();
    }
    onOpenChange(nextOpen);
  };

  const selectedSeatIds = useMemo(
    () => selectedSeats.map((seat) => seat.id),
    [selectedSeats],
  );
  const selectedSeatLabelById = useMemo(
    () => new Map(selectedSeats.map((seat) => [seat.id, seat.label])),
    [selectedSeats],
  );
  const selectedStat = statsQuery.data?.list.find(
    (item) => item.organizationId === organizationId,
  );
  const customTargetNumber =
    /^\d+$/.test(customTarget) && Number(customTarget) > 0
      ? Number(customTarget)
      : null;
  const selectionTargetCount =
    targetMode === "remaining"
      ? (selectedStat?.remainingMemberCount ?? null)
      : customTargetNumber;
  const batchInput = useMemo<OrganizationSeatBatchInput | null>(() => {
    if (organizationId === null) return null;
    if (targetMode === "custom") {
      const targetCount = customTargetNumber;
      if (targetCount === null || !Number.isSafeInteger(targetCount)) {
        return null;
      }
      return {
        planId,
        organizationId,
        orderedSeatIds: selectedSeatIds,
        targetMode: "custom",
        targetCount,
      };
    }
    return {
      planId,
      organizationId,
      orderedSeatIds: selectedSeatIds,
      targetMode: "remaining",
    };
  }, [customTargetNumber, organizationId, planId, selectedSeatIds, targetMode]);
  const snapshotKey = useMemo(
    () =>
      JSON.stringify({
        organizationId,
        targetMode,
        customTarget: targetMode === "custom" ? customTarget : undefined,
        orderedSeatIds: selectedSeatIds,
      }),
    [customTarget, organizationId, selectedSeatIds, targetMode],
  );

  const previewMutation = useMutation({
    mutationFn: ({ input }: BatchRequest) =>
      previewOrganizationSeatBatch(input),
    onSuccess: (data, request) => {
      setPreviewState({ key: request.key, data });
      setMessageState((current) =>
        current?.key === request.key ? null : current,
      );
    },
    onError: (error, request) => {
      setPreviewState(null);
      setMessageState({ key: request.key, text: error.message });
      toast.error(error.message);
    },
  });
  const assignMutation = useMutation({
    mutationFn: ({ input }: BatchRequest) => assignOrganizationSeatBatch(input),
    onSuccess: (result, request) => {
      if (!result.applied) {
        // 服务端在事务中又校验了一次；并发抢座时用这份最新预览取代旧快照。
        setPreviewState({
          key: request.key,
          data: {
            organization: result.organization,
            targetCount: result.targetCount,
            preview: result.preview,
          },
        });
        setMessageState({
          key: request.key,
          text: "可用位置不足，本次没有写入；请调整画布选择后重新预览。",
        });
        return;
      }

      toast.success(
        result.seatIds.length
          ? `已为「${result.organization.name}」占用 ${result.seatIds.length} 个位置`
          : "没有需要新增的团体占位",
      );
      if (result.wasConfirmed) {
        toast.warning("这份排位已经确认发布过，改动后需要重新确认");
      }
      onApplied();
      handleOpenChange(false);
    },
    onError: (error, request) => {
      // 典型场景是预览后被别的操作者抢座，必须重新 preview，不能用旧快照直接重试。
      setPreviewState(null);
      setMessageState({
        key: request.key,
        text: `${error.message} 请重新预览后再提交。`,
      });
      toast.error(error.message);
    },
  });
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

  const previewResult =
    previewState?.key === snapshotKey ? previewState.data : null;
  const message = messageState?.key === snapshotKey ? messageState.text : null;
  const canApply =
    previewResult !== null && previewResult.preview.insufficient === 0;
  const pending =
    previewMutation.isPending ||
    assignMutation.isPending ||
    releaseMutation.isPending;
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

  const validateInput = () => {
    if (organizationId === null) return "请选择团体";
    if (selectedSeatIds.length === 0) return "请先在画布上多选至少一个位置";
    if (targetMode === "custom" && customTargetNumber === null) {
      return "自定义数量必须是正整数";
    }
    return null;
  };

  const requestPreview = () => {
    const error = validateInput();
    if (error || !batchInput) {
      setMessageState({
        key: snapshotKey,
        text: error ?? "请输入有效的占位数量",
      });
      return;
    }
    previewMutation.mutate({ input: batchInput, key: snapshotKey });
  };

  const startSeatSelection = () => {
    if (!onStartSeatSelection) return;
    if (organizationId === null || !selectedStat) {
      setMessageState({ key: snapshotKey, text: "请选择可排座的团体" });
      return;
    }
    if (
      selectionTargetCount === null ||
      !Number.isSafeInteger(selectionTargetCount) ||
      selectionTargetCount <= 0
    ) {
      setMessageState({
        key: snapshotKey,
        text:
          targetMode === "remaining"
            ? "该团体没有待占位成员，无需进入选座"
            : "自定义数量必须是正整数",
      });
      return;
    }

    onStartSeatSelection({
      organizationId,
      organizationName: selectedStat.name,
      targetMode,
      customTarget,
      targetCount: selectionTargetCount,
      mode: selectionMode,
    });
    // 这是“暂离去选座”，不是取消；保留局部状态，重新打开后由草稿一致还原。
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader
            title="团体批量占位"
            description="为选定团体在当前环节的画布位置写入团体占位；不会虚构个人，也不会覆盖已经排座的个人或其他团体。"
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
                  disabled={statsQuery.isLoading || readOnly || pending}
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
                  <FieldDescription>
                    当前环节范围没有团体，不能创建团体占位。
                  </FieldDescription>
                ) : null}
              </Field>

              {selectedStat && selectedColor ? (
                <section
                  className="rounded-lg border p-4"
                  aria-label={`${selectedStat.name} 团体排位统计`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium">
                      <span
                        className="size-3 rounded-full border"
                        style={{
                          backgroundColor: selectedColor.fill,
                          borderColor: selectedColor.stroke,
                        }}
                        aria-hidden
                      />
                      {selectedStat.name}
                    </div>
                    <Badge variant="secondary">
                      团体占位 {selectedStat.organizationSeatCount}
                    </Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                    <Stat
                      value={selectedStat.totalMembers}
                      label="团体总人数"
                    />
                    <Stat
                      value={selectedStat.assignedPersonCount}
                      label="已个人排座"
                    />
                    <Stat
                      value={selectedStat.remainingMemberCount}
                      label="剩余人数"
                    />
                  </dl>
                  <div className="mt-4 rounded-md bg-muted/50 p-3">
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
                      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
                        {individualSeats.map((person) => (
                          <li key={person.segmentMemberId}>
                            {person.name} · {person.takenSeatLabel}
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

              <Field>
                <FieldLabel>目标数量</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    Object.keys(
                      TARGET_MODE_LABELS,
                    ) as OrganizationSeatBatchTargetMode[]
                  ).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={targetMode === mode ? "default" : "outline"}
                      disabled={readOnly || pending}
                      onClick={() => setTargetMode(mode)}
                    >
                      {TARGET_MODE_LABELS[mode]}
                    </Button>
                  ))}
                </div>
                {targetMode === "remaining" ? (
                  <FieldDescription>
                    目标等于该团体尚未按个人排座的人数；已有团体占位不会计作个人排座。
                  </FieldDescription>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      aria-label="自定义团体占位数量"
                      inputMode="numeric"
                      min={1}
                      type="number"
                      value={customTarget}
                      disabled={readOnly || pending}
                      onChange={(event) => setCustomTarget(event.target.value)}
                      placeholder="输入正整数"
                    />
                    <span className="shrink-0 text-muted-foreground text-sm">
                      个位置
                    </span>
                  </div>
                )}
              </Field>

              {onStartSeatSelection ? (
                <Field>
                  <FieldLabel>画布选座方式</FieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      Object.keys(
                        SELECTION_MODE_LABELS,
                      ) as OrganizationSeatBatchSelectionMode[]
                    ).map((mode) => (
                      <Button
                        key={mode}
                        type="button"
                        variant={selectionMode === mode ? "default" : "outline"}
                        disabled={readOnly || pending}
                        onClick={() => setSelectionMode(mode)}
                      >
                        {SELECTION_MODE_LABELS[mode]}
                      </Button>
                    ))}
                  </div>
                  <FieldDescription>
                    连续选座从起点按位置顺序取可用座位；框选区域会按位置顺序取框内前
                    {selectionTargetCount ?? " N"} 个可用座位。
                  </FieldDescription>
                </Field>
              ) : null}

              <section className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    画布已选 {selectedSeats.length} 个位置
                  </span>
                  {selectedSeats.length ? (
                    <span className="text-muted-foreground text-xs">
                      {selectedSeats.map((seat) => seat.label).join("、")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-muted-foreground text-xs">
                  可直接预览当前选择；也可从下方进入画布按所选方式重新选座。
                </p>
              </section>

              {message ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>请先处理这个问题</AlertTitle>
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              ) : null}

              {previewResult ? (
                <PreviewSummary
                  result={previewResult}
                  seatLabelById={selectedSeatLabelById}
                />
              ) : null}
            </FieldGroup>
          </DialogBody>
          <DialogFooter>
            {selectedStat?.organizationSeatCount ? (
              <Button
                type="button"
                variant="destructive"
                disabled={pending || readOnly}
                onClick={() => setReleaseConfirmOpen(true)}
              >
                全部解除该团体占位
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || readOnly}
              onClick={requestPreview}
            >
              {previewMutation.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              预览可用位置
            </Button>
            {onStartSeatSelection ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending || readOnly || selectionTargetCount === null}
                onClick={startSeatSelection}
              >
                开始{SELECTION_MODE_LABELS[selectionMode]}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={!canApply || pending || readOnly}
              onClick={() =>
                batchInput &&
                assignMutation.mutate({ input: batchInput, key: snapshotKey })
              }
            >
              {assignMutation.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : null}
              确认占位
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={releaseConfirmOpen}
        onOpenChange={setReleaseConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>全部解除团体占位？</AlertDialogTitle>
            <AlertDialogDescription>
              将解除「{selectedStat?.name}」在当前方案中的{" "}
              {selectedStat?.organizationSeatCount ?? 0}{" "}
              个团体占位。个人分配和其他团体的占位都不会受到影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={releaseMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={releaseMutation.isPending || organizationId === null}
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
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-2">
      <dt className="font-semibold tabular-nums">{value}</dt>
      <dd className="mt-0.5 text-muted-foreground text-xs">{label}</dd>
    </div>
  );
}

function PreviewSummary({
  result,
  seatLabelById,
}: {
  result: OrganizationSeatBatchPreview;
  seatLabelById: ReadonlyMap<number, string>;
}) {
  const { preview } = result;
  return (
    <section className="rounded-lg border p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-sm">预览结果</h3>
        <Badge variant={preview.insufficient ? "destructive" : "secondary"}>
          计划占位 {preview.plannedSeatIds.length} / 目标 {result.targetCount}
        </Badge>
      </div>
      {preview.plannedSeatIds.length ? (
        <p className="mt-2 text-muted-foreground text-xs">
          将占用：
          {preview.plannedSeatIds
            .map((seatId) => seatLabelById.get(seatId) ?? `#${seatId}`)
            .join("、")}
        </p>
      ) : null}
      {preview.skipped.length ? (
        <ul className="mt-2 space-y-1 text-muted-foreground text-xs">
          {preview.skipped.map((item) => (
            <li key={`${item.seatId}-${item.reason}`}>
              {seatLabelById.get(item.seatId) ?? `#${item.seatId}`}：
              {SKIP_REASON_LABELS[item.reason]}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.insufficient ? (
        <p className="mt-3 text-destructive text-xs">
          还缺 {preview.insufficient}{" "}
          个可用位置；整批不会写入，请调整选择后重新预览。
        </p>
      ) : (
        <p className="mt-3 text-muted-foreground text-xs">
          预览通过后才能提交；若期间位置被他人占用，系统会回滚整批并要求重新预览。
        </p>
      )}
    </section>
  );
}
