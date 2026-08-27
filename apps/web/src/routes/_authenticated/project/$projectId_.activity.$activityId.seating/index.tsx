import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArmchairIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { canvasEditor } from "#/features/venue-editor/canvas";
import { buildPlanDoc } from "#/features/venue-editor/plan-doc";
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

/**
 * `zoneId` 是从场地空间的区域行点「排位」带过来的上下文，`segmentId` 是从
 * 环节详情进入时带来的上下文。
 *
 * 那个按钮原先只是跳到本页、什么都不带——用户点的是"给**这块区域**排位"，
 * 得到的却是排位页首页，还得自己再找环节、再选一遍那块区域（评审 §3.6）。
 * 带上之后：顶部显示来源提示，选区域的弹窗默认高亮它。
 *
 * 场地区域上下文**不做行过滤**：一块区域可以被多个环节引用，而"还没配的
 * 环节"恰恰是用户从这里进来最可能要操作的对象，过滤掉就本末倒置了。环节
 * 上下文则只展示该环节，因为它是详情页明确指定的唯一目标。
 */
const SeatingSearchSchema = z.object({
  zoneId: z.number().int().positive().optional().catch(undefined),
  segmentId: z.number().int().positive().optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/seating/",
)({
  validateSearch: SeatingSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      seatingPlansQueryOptions(Number(params.activityId), deps.segmentId),
    ),
  component: SeatingPage,
});

/**
 * 环节排位总览。
 *
 * **原型的两页在这里合成了一页**（seating-list + seating-confirm）：那两页的列
 * 几乎完全重合，拆开的唯一理由是它们挂在两个二级菜单下；菜单一收，加一个状态
 * 筛选就够了（docs/场地排位底层设计.md §2.1）。
 *
 * 一行一个**开了排位开关的有效环节**，不是一行一个方案——"未配置"是派生态，
 * 它没有方案行，只有左连接才能把它显示出来。作废环节仍由接口返回给议程页，
 * 但不在本页展示。
 */
function SeatingPage() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const { zoneId: fromZoneId, segmentId: fromSegmentId } = Route.useSearch();
  const activityId = Number(activityIdParam);
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const plansQuery = useQuery(
    seatingPlansQueryOptions(activityId, fromSegmentId),
  );
  // 建方案要从活动场地的画布里切出区域的座位，所以这一页也得拿到它。
  const spaceQuery = useQuery(activityVenueListQueryOptions(activityId));

  const [statusFilter, setStatusFilter] = useState<PlanStatus | "all">("all");
  const [pickerFor, setPickerFor] = useState<SeatingPlanRow | null>(null);
  const [rejectFor, setRejectFor] = useState<SeatingPlanRow | null>(null);
  /**
   * 确认和作废都要二次确认。
   *
   * 确认原先是单击即执行——而它是这一页后果最重的操作（对外生效、version +1、
   * 生成座位通知，文档把它定性为高风险），反倒是作废有 `window.confirm`。
   * 现在两个都走 AlertDialog，跟仓库其余页面（人员、项目、邀请函模板…）一致，
   * 顺带把"0 人已排"这种该拦一下的情况摆到确认弹窗里（评审 §3.9–3.11）。
   */
  const [confirmFor, setConfirmFor] = useState<SeatingPlanRow | null>(null);
  const [voidFor, setVoidFor] = useState<SeatingPlanRow | null>(null);

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
  // 作废环节保留在接口结果里供议程页显示历史状态，但排位页只展示有效环节。
  const visible = all.filter((row) => row.segmentStatus !== "voided");
  const rows = visible.filter((row) =>
    statusFilter === "all" ? true : row.plan?.status === statusFilter,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">排位</h2>
          <p className="text-muted-foreground text-sm">
            按环节各自一份方案 · 共 {visible.length} 个开启排位的环节
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

      {fromZoneId && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            从场地空间的「
            {spaceQuery.data?.zones.find((z) => z.id === fromZoneId)?.name ??
              "某个区域"}
            」进来——给下面任一环节点「选择区域」时，它会排在最前面。
          </span>
          <Link
            to="/project/$projectId/activity/$activityId/seating"
            params={{ projectId, activityId: activityIdParam }}
            search={{}}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "ml-auto",
            )}
          >
            清除
          </Link>
        </div>
      )}

      {fromSegmentId && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <span>正在查看某一环节的排位配置。</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary"
            onClick={() =>
              navigate({
                search: (prev) => ({ ...prev, segmentId: undefined }),
              })
            }
          >
            查看全部排位
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{row.segmentName}</span>
                      {/* 环节作废后它的方案不该还能确认（BR-DEV-003B）。整行
                          降级显示，操作列也会相应收窄。 */}
                      {row.segmentStatus === "voided" && (
                        <Badge
                          variant="outline"
                          className="border-destructive/30 bg-destructive/10 text-destructive"
                        >
                          环节已作废
                        </Badge>
                      )}
                      {/* 开关关了但方案还在——这一行原先会整个消失，用户就再也
                          找不到入口作废它了（评审 §3.4）。 */}
                      {!row.seatingEnabled && row.plan && (
                        <Badge
                          variant="outline"
                          className="border-warning/30 bg-warning/10 text-warning-foreground"
                        >
                          排位开关已关闭
                        </Badge>
                      )}
                    </div>
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
                            {row.plan.status === "voided" ? "查看" : "进入排位"}
                          </Link>
                          {/* 环节作废后不能再确认它的排位（BR-DEV-003B），
                              服务端也拦了一道；这里同步收掉按钮，别让用户
                              点了才知道不行。 */}
                          {row.plan.status === "pending" &&
                            row.segmentStatus !== "voided" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={confirmMutation.isPending}
                                  onClick={() => setConfirmFor(row)}
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
                              onClick={() => setVoidFor(row)}
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

      <AlertDialog
        open={confirmFor !== null}
        onOpenChange={(open) => !open && setConfirmFor(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认发布这份排位？</AlertDialogTitle>
            <AlertDialogDescription>
              「{confirmFor?.segmentName}」的排位将对外生效，并生成座位通知。
              确认后再改动会打回待确认，需要重新确认并重发通知。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3">
              将发布 <strong>{confirmFor?.seatCount ?? 0}</strong> 个启用位置，
              其中 <strong>{confirmFor?.assignedCount ?? 0}</strong> 个已排人。
              {confirmFor?.assignedCount === 0 && (
                // 不硬拦——可能真有"自由入座、方案只用来固化座位表"的场景，
                // 但这事必须让人看见再决定（评审 §3.10）。
                <p className="mt-1 text-warning-foreground">
                  目前还没有任何人被排位，确认后发出的座位通知里不会有人。
                </p>
              )}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending}
              onClick={() => {
                if (confirmFor?.plan)
                  confirmMutation.mutate(confirmFor.plan.id);
                setConfirmFor(null);
              }}
            >
              确认发布
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={voidFor !== null}
        onOpenChange={(open) => !open && setVoidFor(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>作废这份排位方案？</AlertDialogTitle>
            <AlertDialogDescription>
              「{voidFor?.segmentName}」已排的 {voidFor?.assignedCount ?? 0}{" "}
              个座位分配会一并解除，方案进入终态不能再改。
              之后可以为这个环节重新建一份新方案。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={voidMutation.isPending}
              onClick={() => {
                if (voidFor?.plan) voidMutation.mutate(voidFor.plan.id);
                setVoidFor(null);
              }}
            >
              作废
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SeatingZonePicker
        open={pickerFor !== null}
        activityId={activityId}
        segmentName={pickerFor?.segmentName ?? ""}
        highlightZoneId={fromZoneId}
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
