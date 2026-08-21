import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArmchairIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { canvasEditor } from "#/features/venue-editor/canvas";
import { buildPlanDoc } from "#/features/venue-editor/plan-doc";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { formatDateTime } from "../../venue/-utils";
import { SeatingRejectDialog } from "../-components/seating-reject-dialog";
import { SeatingZonePicker } from "../-components/seating-zone-picker";
import {
  activityVenueListQueryOptions,
  confirmSeatingPlan,
  createSeatingPlan,
  type PlanStatus,
  rejectSeatingPlan,
  type SeatingPlanRow,
  seatingKeys,
  seatingPlansQueryOptions,
  voidSeatingPlan,
} from "../-venue-queries";
import {
  PLAN_STATUS_CHIP,
  PLAN_STATUS_LABELS,
  PLAN_STATUS_VALUES,
  UNCONFIGURED_CHIP,
} from "../-venue-utils";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/seating/",
)({
  component: SeatingPage,
});

/**
 * 环节排位总览。
 *
 * **原型的两页在这里合成了一页**（seating-list + seating-confirm）：那两页的列
 * 几乎完全重合，拆开的唯一理由是它们挂在两个二级菜单下；菜单一收，加一个状态
 * 筛选就够了（docs/场地排位底层设计.md §2.1）。
 *
 * 一行一个**开了排位开关的环节**，不是一行一个方案——"未配置"是派生态，它没有
 * 方案行，只有左连接才能把它显示出来。
 */
function SeatingPage() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const plansQuery = useQuery(seatingPlansQueryOptions(activityId));
  // 建方案要从活动场地的画布里切出区域的座位，所以这一页也得拿到它。
  const spaceQuery = useQuery(activityVenueListQueryOptions(activityId));

  const [statusFilter, setStatusFilter] = useState<PlanStatus | "all">("all");
  const [pickerFor, setPickerFor] = useState<SeatingPlanRow | null>(null);
  const [rejectFor, setRejectFor] = useState<SeatingPlanRow | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: seatingKeys.all });
  };

  /**
   * 建方案。座位在前端从活动场地的 blob 里切出来再传上去——服务端不解析 blob，
   * 只有编辑器认识它的格式（见 features/venue-editor/plan-doc.ts）。
   */
  const createMutation = useMutation({
    mutationFn: ({
      segmentId,
      zoneId,
    }: {
      segmentId: number;
      zoneId: number;
    }) => {
      const zone = spaceQuery.data?.zones.find((item) => item.id === zoneId);
      if (!zone) throw new Error("活动区域不存在，请刷新后再试");
      const layout = spaceQuery.data?.layouts.find(
        (item) => item.activityVenueId === zone.activityVenueId,
      );

      const { doc, seats } = buildPlanDoc({
        layoutData: layout?.data ?? null,
        zoneExternalId: zone.externalId,
        zoneName: zone.name,
        zoneKind: zone.kind,
      });

      return createSeatingPlan({
        segmentId,
        activityVenueZoneId: zoneId,
        layout: {
          rendererKind: canvasEditor.kind,
          rendererVersion: canvasEditor.version,
          data: doc,
        },
        seats,
      });
    },
    onSuccess: (result) => {
      toast.success(`排位方案已创建，复制了 ${result.seats} 个位置`);
      setPickerFor(null);
      invalidate();
      navigate({
        to: "/project/$projectId/activity/$activityId/seating/$planId",
        params: {
          projectId,
          activityId: activityIdParam,
          planId: String(result.plan.id),
        },
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const confirmMutation = useMutation({
    mutationFn: confirmSeatingPlan,
    onSuccess: (result) => {
      if (!result.applied) {
        toast.error(
          `确认被拦下：${result.blocked
            .map(
              (item) =>
                `${item.label}（${item.memberName}，位置已${
                  item.reason === "removed" ? "删除" : "停用"
                }）`,
            )
            .join("；")}`,
        );
        return;
      }
      // 超出可用点位只提示不阻断——capacity 是活动层的规划数字，不是硬约束。
      if (result.overCapacity) {
        toast.warning(
          `已确认，但启用位置 ${result.overCapacity.seats} 个超过了活动区域规划的 ${result.overCapacity.capacity} 个点位`,
        );
      } else {
        toast.success(`已确认发布，第 ${result.version} 版`);
      }
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ planId, reason }: { planId: number; reason: string }) =>
      rejectSeatingPlan(planId, reason),
    onSuccess: () => {
      toast.success("已退回，排位人员可以重新调整");
      setRejectFor(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const voidMutation = useMutation({
    mutationFn: voidSeatingPlan,
    onSuccess: () => {
      toast.success("方案已作废，座位分配一并解除");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (plansQuery.isLoading) return <Skeleton className="h-96 w-full" />;

  const all = plansQuery.data?.list ?? [];
  const rows = all.filter((row) =>
    statusFilter === "all" ? true : row.plan?.status === statusFilter,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">排位</h2>
          <p className="text-muted-foreground text-sm">
            按环节各自一份方案 · 共 {all.length} 个开启排位的环节
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            items={{ all: "全部状态", ...PLAN_STATUS_LABELS }}
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as PlanStatus | "all")
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {PLAN_STATUS_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {PLAN_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link
            to="/project/$projectId/activity/$activityId/venue"
            params={{ projectId, activityId: activityIdParam }}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <ExternalLinkIcon />
            场地空间
          </Link>
        </div>
      </div>

      {all.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <ArmchairIcon className="size-8 text-muted-foreground/40" />
          <p className="font-medium text-sm">没有开启排位的环节</p>
          <p className="text-muted-foreground text-sm">
            去「议程 /
            环节」里给需要排位的环节打开排位开关，它们才会出现在这里。
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>环节</TableHead>
                <TableHead>引用区域</TableHead>
                <TableHead className="text-right">位置 / 已排</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近保存</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.segmentId}>
                  <TableCell>
                    <div className="font-medium">{row.segmentName}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatDateTime(row.startTime)}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.plan ? (
                      <>
                        <div>{row.zoneName}</div>
                        <div className="text-muted-foreground text-xs">
                          {row.venueName}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">未选择</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.plan ? `${row.seatCount} / ${row.assignedCount}` : "-"}
                  </TableCell>
                  <TableCell>
                    {row.plan ? (
                      <div className="flex flex-col items-start gap-1">
                        <Badge
                          variant="outline"
                          className={cn(
                            "border",
                            PLAN_STATUS_CHIP[row.plan.status],
                          )}
                        >
                          {PLAN_STATUS_LABELS[row.plan.status]}
                          {row.plan.version > 0 && ` · 第${row.plan.version}版`}
                        </Badge>
                        {row.plan.status === "rejected" &&
                          row.plan.rejectedReason && (
                            <span className="text-destructive text-xs">
                              {row.plan.rejectedReason}
                            </span>
                          )}
                      </div>
                    ) : (
                      // 派生态，没有方案行。它不是"坏了"，是还没开始配。
                      <Badge
                        variant="outline"
                        className={cn("border", UNCONFIGURED_CHIP)}
                      >
                        未配置
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(row.plan?.savedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {row.plan ? (
                        <>
                          <Link
                            to="/project/$projectId/activity/$activityId/seating/$planId"
                            params={{
                              projectId,
                              activityId: activityIdParam,
                              planId: String(row.plan.id),
                            }}
                            className={cn(
                              buttonVariants({ variant: "ghost", size: "sm" }),
                            )}
                          >
                            {row.plan.status === "voided" ? "查看" : "进入画布"}
                          </Link>
                          {row.plan.status === "pending" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={confirmMutation.isPending}
                                onClick={() =>
                                  row.plan &&
                                  confirmMutation.mutate(row.plan.id)
                                }
                              >
                                确认
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRejectFor(row)}
                              >
                                退回
                              </Button>
                            </>
                          )}
                          {row.plan.status !== "voided" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={voidMutation.isPending}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `作废「${row.segmentName}」的排位方案？已排的座位会一并解除。`,
                                  )
                                ) {
                                  return;
                                }
                                if (row.plan) voidMutation.mutate(row.plan.id);
                              }}
                            >
                              作废
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPickerFor(row)}
                        >
                          选择区域
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SeatingZonePicker
        open={pickerFor !== null}
        activityId={activityId}
        segmentName={pickerFor?.segmentName ?? ""}
        pending={createMutation.isPending}
        onOpenChange={(open) => !open && setPickerFor(null)}
        onPick={(zoneId) =>
          pickerFor &&
          createMutation.mutate({ segmentId: pickerFor.segmentId, zoneId })
        }
      />

      <SeatingRejectDialog
        open={rejectFor !== null}
        segmentName={rejectFor?.segmentName ?? ""}
        pending={rejectMutation.isPending}
        onOpenChange={(open) => !open && setRejectFor(null)}
        onSubmit={(reason) =>
          rejectFor?.plan &&
          rejectMutation.mutate({ planId: rejectFor.plan.id, reason })
        }
      />
    </div>
  );
}
