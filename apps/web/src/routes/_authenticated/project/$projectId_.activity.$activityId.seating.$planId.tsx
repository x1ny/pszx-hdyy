import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRightIcon,
  CircleSlashIcon,
  DiamondIcon,
  DownloadIcon,
  Maximize2Icon,
  Minimize2Icon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { canvasEditor } from "#/features/venue-editor/canvas";
import { initialState } from "#/features/venue-editor/canvas/core/history";
import {
  EMPTY_SELECTION,
  type Selection,
} from "#/features/venue-editor/canvas/core/interaction";
import {
  type OrganizationSeatSelectionCandidate,
  type OrganizationSeatSelectionResult,
  resolveOrganizationSeatSelection,
} from "#/features/venue-editor/canvas/organization-seat-selection";
import { ZoneSeatingEditor } from "#/features/venue-editor/canvas/react/zone-seating-editor";
import {
  buildSeatOccupantVisual,
  type OrganizationSeatLegendItem,
  organizationSeatLegend,
  type SeatOccupantVisual,
} from "#/features/venue-editor/canvas/seat-occupant-visual";
import { downloadSeatingPlanJpeg } from "#/features/venue-editor/canvas/seating-plan-jpeg";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { formatDateTime } from "../venue/-utils";
import {
  OrganizationSeatBatchDialog,
  type OrganizationSeatBatchSelectionDraft,
} from "./-components/organization-seat-batch-dialog";
import { SeatAssignPanel } from "./-components/seat-assign-panel";
import {
  isTargetFullscreen,
  supportsFullscreenRequest,
} from "./-fullscreen-utils";
import {
  assignSeat,
  organizationSeatingStatsQueryOptions,
  seatingKeys,
  seatingPlanQueryOptions,
  setSeatEnabled,
  swapSeats,
  unassignSeat,
} from "./-venue-queries";
import {
  buildOrganizationSeatInfoById,
  PLAN_STATUS_CHIP,
  PLAN_STATUS_LABELS,
} from "./-venue-utils";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/seating/$planId",
)({
  component: SeatingCanvasPage,
});

/**
 * 环节排位画布。
 *
 * **这里不能再编辑几何**——布局已经在活动空间那份拷贝里定了下来，进了排位
 * 阶段，画布唯一的用途是选中一个位置、在右边把人放上去。`ZoneSeatingEditor`
 * 传了 `assignOnly`：工具栏只剩"选择"和"适配"，拖不动座位，没有撤销/重做/
 * 导入模板，也没有"保存"按钮——排人（`assign`/`unassign`）和启用/停用
 * （`setSeatEnabled`）都是点了就提交的即时操作，不存在"忘了保存"这回事。
 *
 * 这曾经不是这样：早期版本把启用/停用也当几何改动，攒在本地跟画布一起走
 * `saveLayout`。现在改成即时接口，是因为排位阶段的画布已经整体只读，
 * 留一个只为了启用/停用而存在的本地脏状态和保存按钮没有意义。
 */
function SeatingCanvasPage() {
  const { projectId, activityId, planId: planIdParam } = Route.useParams();
  const planId = Number(planIdParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);

  const planQuery = useQuery(seatingPlanQueryOptions(planId));
  // 入口就要知道当前环节有没有可排团体，不能等用户打开弹窗才给空结果。
  const organizationStatsQuery = useQuery(
    organizationSeatingStatsQueryOptions(planId),
  );
  const bundle = planQuery.data;

  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [organizationBatchOpen, setOrganizationBatchOpen] = useState(false);
  const [organizationBatchDraft, setOrganizationBatchDraft] =
    useState<OrganizationSeatBatchSelectionDraft | null>(null);
  const [organizationSelectionSession, setOrganizationSelectionSession] =
    useState<OrganizationSeatBatchSelectionDraft | null>(null);
  const [organizationSelectionResult, setOrganizationSelectionResult] =
    useState<OrganizationSeatSelectionResult | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  /**
   * 对调模式：记住"从哪个座位发起的"，下一次点中座位就是目标。
   *
   * 做成两步点击而不是拖拽——排位画布的几何是只读的，拖拽在这一页已经被
   * `assignOnly` 关掉了，再为对调开一个拖拽手势会跟"这里不能拖"的心智冲突。
   */
  const [swapFrom, setSwapFrom] = useState<{
    id: number;
    label: string;
  } | null>(null);

  const doc = useMemo(() => {
    if (!bundle?.layout) return null;
    return canvasEditor.safeParse(bundle.layout.data);
  }, [bundle?.layout]);
  const state = useMemo(() => (doc ? initialState(doc) : null), [doc]);
  const zone = state?.doc.zones[0] ?? null;

  const seatByExternalId = useMemo(
    () => new Map((bundle?.seats ?? []).map((seat) => [seat.externalId, seat])),
    [bundle?.seats],
  );
  const assignmentBySeatId = useMemo(
    () =>
      new Map(
        (bundle?.assignments ?? []).map((row) => [row.segmentSeatId, row]),
      ),
    [bundle?.assignments],
  );
  const organizationSeatInfoById = useMemo(
    () =>
      buildOrganizationSeatInfoById({
        assignments: bundle?.assignments ?? [],
        seats: bundle?.seats ?? [],
        organizations: organizationStatsQuery.data?.list ?? [],
      }),
    [bundle?.assignments, bundle?.seats, organizationStatsQuery.data?.list],
  );
  const seatStatus = useMemo(() => {
    const map = new Map<
      string,
      { occupant?: SeatOccupantVisual; disabled?: boolean }
    >();
    for (const seat of bundle?.seats ?? []) {
      const assignment = assignmentBySeatId.get(seat.id);
      map.set(seat.externalId, {
        occupant: assignment
          ? buildSeatOccupantVisual({
              occupantType: assignment.occupantType,
              memberName: assignment.memberName,
              organizationId: assignment.organizationId,
              organizationName: assignment.organizationName,
            })
          : undefined,
        disabled: !seat.enabled,
      });
    }
    return map;
  }, [bundle?.seats, assignmentBySeatId]);
  const organizationLegend = useMemo(
    () =>
      organizationSeatLegend(
        Array.from(seatStatus.values(), (status) => status.occupant),
      ),
    [seatStatus],
  );
  const organizationSelectionCandidates = useMemo<
    OrganizationSeatSelectionCandidate[]
  >(() => {
    if (!doc) return [];
    return doc.seats.flatMap((canvasSeat) => {
      const planSeat = seatByExternalId.get(canvasSeat.externalId);
      if (!planSeat) return [];
      const status = seatStatus.get(canvasSeat.externalId);
      return [
        {
          externalId: canvasSeat.externalId,
          label: planSeat.label,
          ordinal: canvasSeat.ordinal,
          zoneExternalId: canvasSeat.zoneExternalId,
          availability:
            !planSeat.enabled || status?.disabled
              ? "disabled"
              : status?.occupant
                ? "occupied"
                : "available",
        },
      ];
    });
  }, [doc, seatByExternalId, seatStatus]);

  const selectedExternalId = selection.seatIds[0] ?? null;
  const selectedSeat = selectedExternalId
    ? (seatByExternalId.get(selectedExternalId) ?? null)
    : null;
  const selectedAssignment = selectedSeat
    ? (assignmentBySeatId.get(selectedSeat.id) ?? null)
    : null;
  // 保持编辑器传回的顺序：团体批量接口把它定义为操作者的显式位置顺序。
  const selectedSeats = useMemo(
    () =>
      selection.seatIds.flatMap((externalId) => {
        const seat = seatByExternalId.get(externalId);
        return seat ? [{ id: seat.id, label: seat.label }] : [];
      }),
    [seatByExternalId, selection.seatIds],
  );

  const readOnly = bundle?.plan.status === "voided";
  const organizationBatchUnavailableReason = readOnly
    ? "方案已作废，不能再修改"
    : organizationStatsQuery.isLoading
      ? "正在读取当前环节团体范围…"
      : organizationStatsQuery.isError
        ? "团体范围加载失败，请刷新页面后重试"
        : organizationStatsQuery.data?.list.length
          ? null
          : "当前环节没有可排团体";
  const isFullscreen = nativeFullscreen || fallbackFullscreen;

  const syncFullscreenState = useCallback(() => {
    const native = isTargetFullscreen(
      document.fullscreenElement,
      document.documentElement,
    );
    setNativeFullscreen(native);
    if (!native) setFallbackFullscreen(false);
  }, []);

  useEffect(() => {
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, [syncFullscreenState]);

  const enterFullscreen = useCallback(async () => {
    // 原生全屏的宿主必须包含 body：Dialog、Select、AlertDialog 和 Toaster 都会
    // 经 Portal 挂到这里。画布本身仍用 frameClassName 铺满视口，所以视觉上只有
    // 排位编辑器全屏。
    const element = document.documentElement;
    if (!supportsFullscreenRequest(element)) {
      setFallbackFullscreen(true);
      return;
    }

    try {
      await element.requestFullscreen();
      syncFullscreenState();
    } catch {
      // 权限策略或 WebView 拒绝原生 API 时，仍提供同样的页面铺满体验。
      setFallbackFullscreen(true);
    }
  }, [syncFullscreenState]);

  const exitFullscreen = useCallback(async () => {
    const element = document.documentElement;
    setFallbackFullscreen(false);
    if (!isTargetFullscreen(document.fullscreenElement, element)) return;

    try {
      await document.exitFullscreen();
    } catch {
      // 全屏已经被浏览器抢先退出时，不需要向用户报错；fullscreenchange 会同步状态。
      syncFullscreenState();
    }
  }, [syncFullscreenState]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: seatingKeys.all });
  };

  const assignMutation = useMutation({
    mutationFn: (input: { seatId: number; segmentMemberId: number }) =>
      assignSeat(planId, input.seatId, input.segmentMemberId),
    onSuccess: (result) => {
      toast.success("已排位");
      if (result.wasConfirmed) {
        toast.warning("这份排位已经确认发布过，改动后需要重新确认");
      }
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const unassignMutation = useMutation({
    mutationFn: (seatId: number) => unassignSeat(planId, seatId),
    onSuccess: () => {
      toast.success("已解除排位");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const swapMutation = useMutation({
    mutationFn: (input: { seatAId: number; seatBId: number }) =>
      swapSeats(planId, input.seatAId, input.seatBId),
    onSuccess: (result) => {
      toast.success("已对调");
      if (result.wasConfirmed) {
        toast.warning("这份排位已经确认发布过，改动后需要重新确认");
      }
      setSwapFrom(null);
      invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
      setSwapFrom(null);
    },
  });

  const startOrganizationSeatSelection = (
    draft: OrganizationSeatBatchSelectionDraft,
  ) => {
    setSwapFrom(null);
    setSelection(EMPTY_SELECTION);
    setOrganizationBatchDraft(draft);
    setOrganizationSelectionSession(draft);
    setOrganizationSelectionResult(null);
    setOrganizationBatchOpen(false);
  };

  const cancelOrganizationSeatSelection = () => {
    setOrganizationSelectionSession(null);
    setOrganizationSelectionResult(null);
    setSelection(EMPTY_SELECTION);
    // 返回设置弹窗不等于仍处于画布选座模式；Escape 与取消按钮都在这里收口。
    setOrganizationBatchOpen(true);
  };

  const completeOrganizationSeatSelection = () => {
    if (!organizationSelectionSession) return;
    if (
      !organizationSelectionResult ||
      organizationSelectionResult.insufficient > 0
    ) {
      toast.error("可用位置不足，请调整起点或框选范围后再完成");
      return;
    }
    setOrganizationSelectionSession(null);
    setOrganizationSelectionResult(null);
    setOrganizationBatchOpen(true);
  };

  /**
   * 对调模式下，点中另一个座位就是"选目标"而不是"改选中"。
   * 点空白处（没有座位）当取消——不然进了对调模式就只能靠按钮退出。
   */
  const handleSelectionChange = (next: Selection) => {
    if (organizationSelectionSession) {
      const result = resolveOrganizationSeatSelection({
        mode: organizationSelectionSession.mode,
        targetCount: organizationSelectionSession.targetCount,
        zoneExternalId: zone?.externalId ?? "",
        requestedExternalIds: next.seatIds,
        candidates: organizationSelectionCandidates,
      });
      setOrganizationSelectionResult(result);
      setSelection({ zoneIds: [], seatIds: result.selectedExternalIds });
      return;
    }

    if (!swapFrom) {
      setSelection(next);
      return;
    }
    const targetExternalId = next.seatIds[0];
    const target = targetExternalId
      ? seatByExternalId.get(targetExternalId)
      : undefined;

    if (!target) {
      setSwapFrom(null);
      setSelection(next);
      return;
    }
    if (target.id === swapFrom.id) return; // 点回自己，什么都不做

    swapMutation.mutate({ seatAId: swapFrom.id, seatBId: target.id });
  };

  const setEnabledMutation = useMutation({
    mutationFn: (input: { seatId: number; enabled: boolean }) =>
      setSeatEnabled(planId, input.seatId, input.enabled),
    onSuccess: (result) => {
      if (!result.applied) {
        const [item] = result.blocked;
        toast.error(
          `停用被拦下：${item?.label ?? ""} 上还坐着 ${item?.memberName ?? "人"}，请先解除排位`,
        );
        return;
      }
      toast.success("已更新");
      if (result.wasConfirmed) {
        toast.warning("这份排位已经确认发布过，改动后需要重新确认");
      }
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const exportJpeg = async () => {
    if (!doc || !bundle) return;

    setIsExporting(true);
    try {
      const result = await downloadSeatingPlanJpeg({
        doc,
        seatStatus,
        title: `${bundle.plan.segmentName} · ${bundle.plan.zoneName} 排位图`,
        subtitle: [bundle.plan.venueName, bundle.plan.zoneName]
          .filter(Boolean)
          .join(" / "),
        segmentName: bundle.plan.segmentName,
        zoneName: bundle.plan.zoneName,
      });
      toast.success(
        result.raster.downsampled
          ? "已导出 JPG（已在浏览器安全像素范围内缩放）"
          : "已导出 JPG",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出 JPG 失败");
    } finally {
      setIsExporting(false);
    }
  };

  if (planQuery.isLoading || !bundle) {
    return <Skeleton className="h-96 w-full" />;
  }

  const goBack = () =>
    navigate({
      to: "/project/$projectId/activity/$activityId/seating",
      params: { projectId, activityId },
    });

  // 非全屏时提示沿用页面里的原位置；全屏的可视壳只覆盖 ZoneSeatingEditor，
  // 所以把同一份提示改由它的 headerContent 承载。两处始终只会渲染一处，选座
  // 状态和取消/完成处理函数也只有这一份。
  const editorOperationNotices =
    organizationSelectionSession || swapFrom ? (
      <div className="flex flex-col gap-3">
        {organizationSelectionSession ? (
          <OrganizationSeatSelectionNotice
            draft={organizationSelectionSession}
            result={organizationSelectionResult}
            onCancel={cancelOrganizationSeatSelection}
            onComplete={completeOrganizationSeatSelection}
          />
        ) : null}

        {swapFrom ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-sm">
            <ArrowLeftRightIcon className="size-4 shrink-0 text-primary" />
            <span>
              正在对调 <strong>{swapFrom.label}</strong>
              ——点画布上的另一个座位完成对调。
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setSwapFrom(null)}
            >
              取消
            </Button>
          </div>
        ) : null}
      </div>
    ) : null;

  if (!doc || !zone || !state) {
    // blob 解不出来（换过渲染器、或者数据坏了）。核心表里的位置还在，所以这里
    // 给一个能看的降级说明而不是白屏——底层设计 §9 那条降级视图的最低要求。
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <CircleSlashIcon className="size-8 text-muted-foreground/40" />
        <p className="font-medium text-sm">这份排位的画布数据打不开</p>
        <p className="text-muted-foreground text-sm">
          方案里有 {bundle.seats.length} 个位置、{bundle.assignments.length}{" "}
          条排位记录，数据都在，只是渲染器认不出画布格式。
        </p>
        <Button variant="outline" onClick={goBack}>
          返回排位列表
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-lg tracking-tight">
              {bundle.plan.segmentName}
            </h2>
            <Badge
              variant="outline"
              className={cn("border", PLAN_STATUS_CHIP[bundle.plan.status])}
            >
              {PLAN_STATUS_LABELS[bundle.plan.status]}
              {bundle.plan.version > 0 && ` · 第${bundle.plan.version}版`}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {bundle.plan.venueName} / {bundle.plan.zoneName} ·{" "}
            {bundle.seats.length} 个位置 · 已排 {bundle.assignments.length} 人
          </p>
        </div>
      </div>

      {/**
       * 底图过期提示。上游活动空间的画布在本方案保存之后又改过，说明这份排位
       * 用的是旧快照。**只提示，不自动同步**——快照隔离是设计意图，自动跟随
       * 会让已确认的排位静默变形（评审 §3.8）。
       */}
      {bundle.plan.spaceUpdatedAt &&
        bundle.plan.savedAt &&
        new Date(bundle.plan.spaceUpdatedAt) >
          new Date(bundle.plan.savedAt) && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              活动空间的平面图在这份排位保存之后改过（
              {formatDateTime(bundle.plan.spaceUpdatedAt)}）。
              这里显示的仍是建立方案时的快照——是有意如此，改动不会自动同步过来。
              如果上游的调整需要体现到排位里，请作废本方案后重新建。
            </div>
          </div>
        )}

      {bundle.plan.status === "rejected" && bundle.plan.rejectedReason && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>被退回：{bundle.plan.rejectedReason}</div>
        </div>
      )}

      {!isFullscreen ? editorOperationNotices : null}

      <ZoneSeatingEditor
        frameRef={fullscreenRef}
        frameClassName={
          isFullscreen
            ? "fixed inset-0 z-50 h-dvh w-dvw overflow-hidden bg-background p-4"
            : undefined
        }
        headerContent={isFullscreen ? editorOperationNotices : null}
        zone={zone}
        state={state}
        selection={selection}
        onSelectionChange={handleSelectionChange}
        onCommand={() => {
          /* assignOnly：不会被真的调用，见 zone-seating-editor.tsx 里 assignOnly 的说明。 */
        }}
        onBack={goBack}
        backLabel="返回排位列表"
        seatStatus={seatStatus}
        assignOnly
        isFullscreen={isFullscreen}
        onExitFullscreen={exitFullscreen}
        onEscape={() => {
          if (!organizationSelectionSession) return false;
          cancelOrganizationSeatSelection();
          return true;
        }}
        toolbarActions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isExporting}
              onClick={exportJpeg}
            >
              <DownloadIcon data-icon="inline-start" />
              {isExporting ? "正在导出…" : "导出 JPG"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={
                isFullscreen ? "退出全屏排位画布" : "进入全屏排位画布"
              }
              aria-pressed={isFullscreen}
              onClick={isFullscreen ? exitFullscreen : enterFullscreen}
            >
              {isFullscreen ? (
                <Minimize2Icon data-icon="inline-start" />
              ) : (
                <Maximize2Icon data-icon="inline-start" />
              )}
              {isFullscreen ? "退出全屏" : "全屏"}
            </Button>
          </>
        }
        legend={<SeatStatusLegend organizations={organizationLegend} />}
        rightPanel={
          <div className="flex w-72 shrink-0 flex-col gap-3">
            {!readOnly && (
              <>
                <Button
                  variant="outline"
                  disabled={
                    organizationBatchUnavailableReason !== null ||
                    organizationSelectionSession !== null
                  }
                  onClick={() => setOrganizationBatchOpen(true)}
                >
                  <UsersRoundIcon />
                  团体批量占位
                </Button>
                {organizationBatchUnavailableReason ? (
                  <p className="px-1 text-muted-foreground text-xs">
                    {organizationBatchUnavailableReason}
                  </p>
                ) : null}
                <OrganizationSeatBatchDialog
                  open={organizationBatchOpen}
                  planId={planId}
                  selectedSeats={selectedSeats}
                  readOnly={readOnly}
                  selectionDraft={organizationBatchDraft}
                  onOpenChange={setOrganizationBatchOpen}
                  onDismiss={() => {
                    setOrganizationBatchDraft(null);
                    setOrganizationSelectionSession(null);
                    setOrganizationSelectionResult(null);
                  }}
                  onStartSeatSelection={startOrganizationSeatSelection}
                  onApplied={() => {
                    setSelection(EMPTY_SELECTION);
                    setOrganizationBatchDraft(null);
                    setOrganizationSelectionSession(null);
                    setOrganizationSelectionResult(null);
                    invalidate();
                  }}
                />
              </>
            )}
            <SeatAssignPanel
              planId={planId}
              seat={selectedSeat}
              assignment={selectedAssignment}
              readOnly={readOnly}
              pending={assignMutation.isPending || unassignMutation.isPending}
              organizationSeatInfoById={organizationSeatInfoById}
              onAssign={(segmentMemberId) =>
                selectedSeat &&
                assignMutation.mutate({
                  seatId: selectedSeat.id,
                  segmentMemberId,
                })
              }
              onUnassign={() =>
                selectedSeat && unassignMutation.mutate(selectedSeat.id)
              }
            />

            {/* 对调只在这个座位上有人时才有意义——空座位要"换人"直接在上面的
                候选人列表里点一下就行，不需要走对调。 */}
            {selectedSeat && selectedAssignment && !readOnly && (
              <Button
                variant="outline"
                disabled={swapMutation.isPending}
                onClick={() =>
                  setSwapFrom({
                    id: selectedSeat.id,
                    label: selectedSeat.label,
                  })
                }
              >
                <ArrowLeftRightIcon />
                与其它座位对调
              </Button>
            )}

            {/* 启用/停用是本环节的业务状态，不是几何，跟排人一样即时提交
                （§17.5）——排位阶段的画布已经只读，不需要再有一个只为它
                存在的本地脏状态和保存按钮。 */}
            {selectedSeat && !readOnly && (
              <Button
                variant="outline"
                disabled={setEnabledMutation.isPending}
                onClick={() =>
                  selectedSeat &&
                  setEnabledMutation.mutate({
                    seatId: selectedSeat.id,
                    enabled: !selectedSeat.enabled,
                  })
                }
              >
                {selectedSeat.enabled ? "本环节停用此位置" : "本环节启用此位置"}
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}

const ORGANIZATION_SELECTION_SKIP_LABELS = {
  disabled: "已停用",
  occupied: "已占用",
} as const;

function OrganizationSeatSelectionNotice({
  draft,
  result,
  onCancel,
  onComplete,
}: {
  draft: OrganizationSeatBatchSelectionDraft;
  result: OrganizationSeatSelectionResult | null;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const selectedCount = result?.selectedExternalIds.length ?? 0;
  const insufficient = result?.insufficient ?? draft.targetCount;
  const ready = result !== null && insufficient === 0;

  return (
    <section
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-sm"
      aria-live="polite"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <UsersRoundIcon className="size-4 shrink-0 text-primary" />
          <span className="font-medium">
            正在为「{draft.organizationName}」
            {draft.mode === "continuous" ? "连续选座" : "框选区域"}
          </span>
          <Badge variant={ready ? "secondary" : "outline"}>
            已选 {selectedCount} / {draft.targetCount}
          </Badge>
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          {draft.mode === "continuous"
            ? "点击画布中的起始座位，系统会按位置顺序向后取可用座位。"
            : "从画布空白处拖拽框住位置，系统会按位置顺序取框内可用座位。"}
        </p>
        {result?.skipped.length ? (
          <p className="mt-1 text-muted-foreground text-xs">
            已跳过 {result.skipped.length} 个不可用位置（
            {result.skipped
              .slice(0, 3)
              .map(
                (seat) =>
                  seat.label +
                  "：" +
                  ORGANIZATION_SELECTION_SKIP_LABELS[seat.reason],
              )
              .join("、")}
            {result.skipped.length > 3 ? "…" : ""}）。
          </p>
        ) : null}
        {result?.overflowCount ? (
          <p className="mt-1 text-muted-foreground text-xs">
            框内多出的 {result.overflowCount}{" "}
            个可用位置未选入，已按位置顺序只保留前 {draft.targetCount} 个。
          </p>
        ) : null}
        {insufficient > 0 ? (
          <p className="mt-1 text-destructive text-xs">
            还差 {insufficient} 个可用位置，暂不能完成选座。
          </p>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          取消选座
        </Button>
        <Button type="button" size="sm" disabled={!ready} onClick={onComplete}>
          完成选座
        </Button>
      </div>
    </section>
  );
}

function SeatStatusLegend({
  organizations,
}: {
  organizations: readonly OrganizationSeatLegendItem[];
}) {
  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs"
      aria-label="座位状态图例"
    >
      <span className="font-medium text-foreground">图例</span>
      <span className="flex items-center gap-1">
        <span
          className="size-3 rounded-full border border-primary/25 bg-card"
          aria-hidden
        />
        空闲
      </span>
      <span className="flex items-center gap-1">
        <span className="size-3 rounded-full bg-primary" aria-hidden />
        无团体个人
      </span>
      <span className="flex items-center gap-1">
        <DiamondIcon className="size-3 text-warning-foreground" aria-hidden />
        VIP
      </span>
      <span className="flex items-center gap-1">
        <CircleSlashIcon className="size-3" aria-hidden />
        停用
      </span>
      <span className="flex items-center gap-1">
        <span
          className="flex size-3.5 items-center justify-center rounded-full bg-primary/15"
          aria-hidden
        >
          <span className="size-2.5 rounded-full border border-primary/25 bg-card" />
        </span>
        已选中
      </span>
      {organizations.length > 0 ? (
        <>
          <span className="mx-1 h-3 w-px bg-border" aria-hidden />
          <span className="font-medium text-foreground">当前占用团体</span>
          {organizations.map((organization) => (
            <span
              key={organization.organizationId}
              className="flex items-center gap-1"
            >
              <span
                className="size-3 rounded-full"
                style={{
                  backgroundColor: organization.color.fill,
                }}
                aria-hidden
              />
              {organization.organizationName}
            </span>
          ))}
        </>
      ) : null}
    </section>
  );
}
