import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleSlashIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { canvasEditor } from "#/features/venue-editor/canvas";
import { initialState } from "#/features/venue-editor/canvas/core/history";
import {
  EMPTY_SELECTION,
  type Selection,
} from "#/features/venue-editor/canvas/core/interaction";
import { ZoneSeatingEditor } from "#/features/venue-editor/canvas/react/zone-seating-editor";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { SeatAssignPanel } from "./-components/seat-assign-panel";
import {
  assignActivityMemberToSeat,
  assignSeat,
  seatingKeys,
  seatingPlanQueryOptions,
  setSeatEnabled,
  unassignSeat,
} from "./-venue-queries";
import { PLAN_STATUS_CHIP, PLAN_STATUS_LABELS } from "./-venue-utils";

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

  const planQuery = useQuery(seatingPlanQueryOptions(planId));
  const bundle = planQuery.data;

  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);

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
  const seatStatus = useMemo(() => {
    const map = new Map<
      string,
      { occupantName?: string; disabled?: boolean }
    >();
    for (const seat of bundle?.seats ?? []) {
      const assignment = assignmentBySeatId.get(seat.id);
      map.set(seat.externalId, {
        occupantName: assignment?.memberName,
        disabled: !seat.enabled,
      });
    }
    return map;
  }, [bundle?.seats, assignmentBySeatId]);

  const selectedExternalId = selection.seatIds[0] ?? null;
  const selectedSeat = selectedExternalId
    ? (seatByExternalId.get(selectedExternalId) ?? null)
    : null;
  const selectedAssignment = selectedSeat
    ? (assignmentBySeatId.get(selectedSeat.id) ?? null)
    : null;

  const readOnly = bundle?.plan.status === "voided";

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

  const assignActivityMemberMutation = useMutation({
    mutationFn: (input: { seatId: number; activityMemberId: number }) =>
      assignActivityMemberToSeat(planId, input.seatId, input.activityMemberId),
    onSuccess: () => {
      toast.success("已排位，并把该人员加入了本环节人员");
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

  if (planQuery.isLoading || !bundle) {
    return <Skeleton className="h-96 w-full" />;
  }

  const goBack = () =>
    navigate({
      to: "/project/$projectId/activity/$activityId/seating",
      params: { projectId, activityId },
    });

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

      {bundle.plan.status === "rejected" && bundle.plan.rejectedReason && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>被退回：{bundle.plan.rejectedReason}</div>
        </div>
      )}

      <ZoneSeatingEditor
        zone={zone}
        state={state}
        selection={selection}
        onSelectionChange={setSelection}
        onCommand={() => {
          /* assignOnly：不会被真的调用，见 zone-seating-editor.tsx 里 assignOnly 的说明。 */
        }}
        onBack={goBack}
        backLabel="返回排位列表"
        seatStatus={seatStatus}
        assignOnly
        rightPanel={
          <div className="flex w-72 shrink-0 flex-col gap-3">
            <SeatAssignPanel
              planId={planId}
              seat={selectedSeat}
              assignment={selectedAssignment}
              readOnly={readOnly}
              pending={
                assignMutation.isPending ||
                assignActivityMemberMutation.isPending ||
                unassignMutation.isPending
              }
              onAssign={(segmentMemberId) =>
                selectedSeat &&
                assignMutation.mutate({
                  seatId: selectedSeat.id,
                  segmentMemberId,
                })
              }
              onAssignActivityMember={(activityMemberId) =>
                selectedSeat &&
                assignActivityMemberMutation.mutate({
                  seatId: selectedSeat.id,
                  activityMemberId,
                })
              }
              onUnassign={() =>
                selectedSeat && unassignMutation.mutate(selectedSeat.id)
              }
            />

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
