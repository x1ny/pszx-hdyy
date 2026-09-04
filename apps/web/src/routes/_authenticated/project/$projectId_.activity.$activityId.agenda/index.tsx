import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ListIcon,
  PlusIcon,
  RouteIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { lineLabel } from "#/features/agenda/labels";
import {
  type AgendaLine,
  agendaKeys,
  agendaQueryOptions,
  createAgendaLine,
  createSegment,
  deleteAgendaLine,
  type Segment,
  setSegmentStatus,
  updateAgendaLine,
  updateSegment,
} from "#/features/agenda/queries";
import {
  segmentMemberConflictQueryOptions,
  segmentMemberKeys,
} from "#/features/member/relation-queries.ts";
import { activityDetailQueryOptions } from "#/features/project/queries";
import { isOpenTodo } from "#/features/resource/labels.ts";
import {
  type ResourceDemand,
  resourceDemandKeys,
  resourceDemandListQueryOptions,
} from "#/features/resource/queries.ts";
import { SegmentDemandsDialog } from "#/features/resource/segment-demands-dialog.tsx";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { seatingKeys, seatingPlansQueryOptions } from "../-venue-queries";
import { AgendaLineDialog } from "./-components/agenda-line-dialog";
import { AgendaTimeline } from "./-components/agenda-timeline";
import { SegmentDetailDialog } from "./-components/segment-detail-dialog";
import {
  SegmentFormDialog,
  type SegmentFormSubmitValues,
} from "./-components/segment-form-dialog";
import { SegmentMembersDialog } from "./-components/segment-members-dialog";
import { SegmentTable } from "./-components/segment-table";
import {
  buildAgendaTimeline,
  buildSequenceLabels,
  formatSegmentRange,
} from "./-utils";

/**
 * 视图和"含作废"走 URL search params，不用 useState——刷新、分享链接、
 * 浏览器后退都要能回到同一个视图。每个字段都带 `.catch()`：别人手改 URL
 * 传乱七八糟的值时降级成默认视图，而不是崩掉。
 */
const AgendaSearchSchema = z.object({
  view: z.enum(["timeline", "list"]).default("timeline").catch("timeline"),
  includeVoided: z.boolean().default(false).catch(false),
});

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/agenda/",
)({
  validateSearch: AgendaSearchSchema,
  // 议程、资源需求、人员状态和排位状态一起预取：它们都是首屏时间轴图标或
  // 提示的数据源，分开取等于给首屏排了个瀑布。
  loader: ({ context, params }) => {
    const activityId = Number(params.activityId);
    return Promise.all([
      context.queryClient.ensureQueryData(agendaQueryOptions(activityId)),
      context.queryClient.ensureQueryData(
        resourceDemandListQueryOptions(activityId),
      ),
      context.queryClient.ensureQueryData(
        segmentMemberConflictQueryOptions(activityId),
      ),
      context.queryClient.ensureQueryData(seatingPlansQueryOptions(activityId)),
    ]);
  },
  component: AgendaTab,
});

function AgendaTab() {
  const { projectId: projectIdParam, activityId: activityIdParam } =
    Route.useParams();
  const activityId = Number(activityIdParam);
  // 环节人员弹窗的选择器要能按"本项目人员"筛，所以这一层也要把 projectId 带下去。
  const projectId = Number(projectIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Segment>();
  const [detail, setDetail] = useState<Segment>();
  const [memberSegment, setMemberSegment] = useState<Segment>();
  const [demandSegment, setDemandSegment] = useState<Segment>();
  const [lineDialogOpen, setLineDialogOpen] = useState(false);

  const agendaQuery = useQuery(agendaQueryOptions(activityId));
  // 需求项全量一次拿回，这里只用来画列表那一列的 chip 和统计磁贴；
  // 弹窗里读的是同一份缓存，不会再发一次请求。
  const demandQuery = useQuery(resourceDemandListQueryOptions(activityId));
  // 人员时间冲突由后端整场活动扫一遍算好（同一个人被排进两个时间重叠的
  // 环节），这里只负责把结论显示出来。
  const conflictQuery = useQuery(segmentMemberConflictQueryOptions(activityId));
  const seatingQuery = useQuery(seatingPlansQueryOptions(activityId));
  // 父路由（活动详情布局）的 loader 已经 ensureQueryData 过，这里是缓存命中
  const { data: activity } = useQuery(activityDetailQueryOptions(activityId));

  const lines = agendaQuery.data?.lines ?? [];
  const segments = agendaQuery.data?.segments ?? [];

  /**
   * 环节一变，资源需求那份缓存也要跟着失效。
   *
   * 不是可有可无的保险：需求项列表里带着 `segmentName`、`segmentStatus`、
   * `segmentStartTime`——改个环节名、调个时间、把环节作废，这三样全变。只失效
   * 议程的话，本页那一列 chip 和资源需求汇总页都会继续拿旧环节信息渲染，
   * 而且作废后的环节还会照常出现在待办里催人配资源。
   */
  const invalidateAgenda = () => {
    queryClient.invalidateQueries({ queryKey: agendaKeys.all });
    queryClient.invalidateQueries({ queryKey: resourceDemandKeys.all });
    // 排位总览以环节的开关为左表条件；打开或关闭排位开关都会改变那份列表。
    queryClient.invalidateQueries({
      queryKey: seatingKeys.plans(activityId),
    });
    // 人员时间冲突是"人 × 环节时间"算出来的，改时间、作废、恢复都会让它变。
    // 反方向（加人、移人）由环节人员弹窗那句 invalidate 覆盖——那个 key 是
    // 这条的父级。
    queryClient.invalidateQueries({
      queryKey: segmentMemberKeys.conflicts(activityId),
    });
  };

  /**
   * 保存环节。表单里选了"＋ 新建并行线"时，先建线再建环节——这样"在一条
   * 新并行线上加一个环节"是一次保存动作，不用先关掉表单去别处建线。
   *
   * 同名并行线直接复用而不是再建一条：环节保存失败后用户改完重试时，不会
   * 一次留下一条同名空线。
   */
  const saveMutation = useMutation({
    mutationFn: async (values: SegmentFormSubmitValues) => {
      let agendaLineId = values.agendaLineId;

      if (values.newLineName) {
        const existing = lines.find(
          (line) =>
            line.lineType === "parallel" && line.name === values.newLineName,
        );
        const line =
          existing ??
          (await createAgendaLine({
            activityId,
            name: values.newLineName,
            sortOrder:
              lines.filter((item) => item.lineType === "parallel").length + 1,
          }));
        agendaLineId = line.id;
      }

      const payload = {
        name: values.name,
        segmentType: values.segmentType,
        agendaLineId,
        startTime: values.startTime,
        endTime: values.endTime,
        locationText: values.locationText,
        ownerName: values.ownerName,
        description: values.description,
        memberEnabled: values.memberEnabled,
        seatingEnabled: values.seatingEnabled,
      };

      return editing
        ? updateSegment({ ...payload, id: editing.id })
        : createSegment({ ...payload, activityId });
    },
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidateAgenda();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: (segment: Segment) =>
      setSegmentStatus(
        segment.id,
        segment.status === "active" ? "voided" : "active",
      ),
    onSuccess: (updated) => {
      toast.success(updated.status === "voided" ? "环节已作废" : "环节已恢复");
      invalidateAgenda();
    },
    onError: (error) => toast.error(error.message),
  });

  const lineMutation = useMutation({
    mutationFn: (
      action:
        | { type: "create"; name: string; sortOrder: number }
        | { type: "update"; id: number; name?: string; sortOrder: number }
        | { type: "delete"; line: AgendaLine },
    ) => {
      if (action.type === "create") {
        return createAgendaLine({
          activityId,
          name: action.name,
          sortOrder: action.sortOrder,
        });
      }
      if (action.type === "update") {
        return updateAgendaLine({
          id: action.id,
          name: action.name,
          sortOrder: action.sortOrder,
        });
      }
      return deleteAgendaLine(action.line.id);
    },
    onSuccess: (_data, action) => {
      toast.success(
        action.type === "create"
          ? "并行线已新增"
          : action.type === "update"
            ? "议程线已保存"
            : "议程线已删除",
      );
      invalidateAgenda();
    },
    onError: (error) => toast.error(error.message),
  });

  if (agendaQuery.isPending || !activity) {
    return <Skeleton className="h-96 w-full" />;
  }

  const activeSegments = segments.filter(
    (segment) => segment.status === "active",
  );
  const voidedCount = segments.length - activeSegments.length;
  const parallelCount = lines.filter(
    (line) => line.lineType === "parallel",
  ).length;
  const seatingCount = activeSegments.filter(
    (segment) => segment.seatingEnabled,
  ).length;

  const timeline = buildAgendaTimeline(lines, segments);
  const sequenceLabels = buildSequenceLabels(lines, segments);

  const demands = demandQuery.data?.list ?? [];
  const demandsBySegment = new Map<number, ResourceDemand[]>();
  for (const demand of demands) {
    const bucket = demandsBySegment.get(demand.segmentId);
    if (bucket) bucket.push(demand);
    else demandsBySegment.set(demand.segmentId, [demand]);
  }
  const openTodoCount = demands.filter(isOpenTodo).length;

  const memberCounts = new Map(
    (conflictQuery.data?.memberCounts ?? []).map(({ segmentId, count }) => [
      segmentId,
      count,
    ]),
  );
  const seatingStatusBySegment = new Map(
    (seatingQuery.data?.list ?? []).map((row) => [
      row.segmentId,
      row.plan?.status ?? null,
    ]),
  );

  // 超出活动时间范围只提示不阻断（C-016：本期业务冲突允许保存但提示）
  const outOfRange = activeSegments.filter(
    (segment) =>
      new Date(segment.startTime) < new Date(activity.startTime) ||
      new Date(segment.endTime) > new Date(activity.endTime),
  );

  // 同上，人员冲突也是只提示不阻断（C-016）：不同议程线本来就允许并行，
  // 一个人能不能两头兼顾只有运营判断得了。
  const conflicts = conflictQuery.data?.list ?? [];

  const tableSegments = search.includeVoided ? segments : activeSegments;

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (segment: Segment) => {
    setDetail(undefined);
    setEditing(segment);
    setFormOpen(true);
  };


  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="环节总数"
          value={segments.length}
          hint={`正常 ${activeSegments.length} / 作废 ${voidedCount}`}
        />
        <StatTile
          label="议程线"
          value={lines.length}
          hint={`主线 ${lines.length - parallelCount} + 并行线 ${parallelCount}`}
        />
        <StatTile
          label="覆盖天数"
          value={timeline.length}
          hint="按环节覆盖日期分组，跨日环节每天都算"
        />
        <StatTile
          label="资源需求待办"
          value={openTodoCount}
          hint={`共声明 ${demands.length} 项 · 已开启排位 ${seatingCount}`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-sm">
          <ViewButton
            active={search.view === "timeline"}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, view: "timeline" }) })
            }
          >
            <RouteIcon />
            时间轴
          </ViewButton>
          <ViewButton
            active={search.view === "list"}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, view: "list" }) })
            }
          >
            <ListIcon />
            环节列表
          </ViewButton>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {search.view === "list" && (
            <label
              htmlFor="include-voided"
              className="flex cursor-pointer items-center gap-2 text-muted-foreground text-sm"
            >
              <Checkbox
                id="include-voided"
                checked={search.includeVoided}
                onCheckedChange={(checked) =>
                  navigate({
                    search: (prev) => ({ ...prev, includeVoided: !!checked }),
                  })
                }
              />
              显示作废环节
            </label>
          )}
          <Button variant="outline" onClick={() => setLineDialogOpen(true)}>
            议程线管理
          </Button>
          <Button onClick={openCreate}>
            <PlusIcon />
            新增环节
          </Button>
        </div>
      </div>

      {outOfRange.length > 0 && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>
            有 {outOfRange.length} 个环节排在活动时间范围之外
          </AlertTitle>
          <AlertDescription>
            {outOfRange
              .slice(0, 3)
              .map((segment) => segment.name)
              .join("、")}
            {outOfRange.length > 3 && ` 等 ${outOfRange.length} 个`}
            ——不影响保存，确认不是时间填错即可。
          </AlertDescription>
        </Alert>
      )}

      {conflicts.length > 0 && (
        <Alert>
          <UsersRoundIcon />
          <AlertTitle>有 {conflicts.length} 处人员时间冲突</AlertTitle>
          {/* 一处冲突一行：一个人同时被排进两个时间重叠的环节。多于三处时
              只列前三行，剩下的报个数——这条提示是让人知道"有问题、去哪看"，
              不是冲突清单。 */}
          <AlertDescription className="flex flex-col gap-1">
            {conflicts.slice(0, 3).map((conflict) => {
              const [first, second] = conflict.segments;
              return (
                <span key={`${conflict.memberId}-${first.id}-${second.id}`}>
                  {conflict.memberName} 在「{first.name}」（
                  {formatSegmentRange(first)}）、「{second.name}」（
                  {formatSegmentRange(second)}）中存在时间冲突
                </span>
              );
            })}
            <span>
              {conflicts.length > 3 && `……等 ${conflicts.length} 处。`}
              不影响保存，请确认是否填错即可。
            </span>
          </AlertDescription>
        </Alert>
      )}

      {search.view === "timeline" ? (
        <AgendaTimeline
          days={timeline}
          demandsBySegment={demandsBySegment}
          memberCounts={memberCounts}
          seatingStatusBySegment={seatingStatusBySegment}
          onSelect={setDetail}
        />
      ) : (
        <SegmentTable
          segments={tableSegments}
          lines={lines}
          sequenceLabels={sequenceLabels}
          demandsBySegment={demandsBySegment}
          memberCounts={memberCounts}
          seatingStatusBySegment={seatingStatusBySegment}
          pendingStatusId={
            statusMutation.isPending ? statusMutation.variables?.id : undefined
          }
          onDetail={setDetail}
          onEdit={openEdit}
          onToggleStatus={(segment) => statusMutation.mutate(segment)}
          onManageDemands={setDemandSegment}
        />
      )}

      <SegmentFormDialog
        open={formOpen}
        segment={editing}
        lines={lines}
        activityRange={{ start: activity.startTime, end: activity.endTime }}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <SegmentDetailDialog
        segment={detail}
        lines={lines}
        memberCount={detail ? memberCounts.get(detail.id) : undefined}
        seatingStatus={
          detail ? seatingStatusBySegment.get(detail.id) : undefined
        }
        onOpenChange={(open) => {
          if (!open) setDetail(undefined);
        }}
        onEdit={openEdit}
        onEnterSeating={(segment) => {
          setDetail(undefined);
          navigate({
            to: "/project/$projectId/activity/$activityId/seating",
            params: {
              projectId: projectIdParam,
              activityId: activityIdParam,
            },
            search: { segmentId: segment.id },
          });
        }}
        onManageMembers={(segment) => {
          setDetail(undefined);
          setMemberSegment(segment);
        }}
        onManageDemands={(segment) => {
          setDetail(undefined);
          setDemandSegment(segment);
        }}
      />

      <SegmentMembersDialog
        segmentId={memberSegment?.id}
        segmentName={memberSegment?.name}
        projectId={projectId}
        activityId={activityId}
        open={!!memberSegment}
        onOpenChange={(open) => {
          if (!open) setMemberSegment(undefined);
        }}
      />

      <SegmentDemandsDialog
        segmentId={demandSegment?.id}
        segmentName={demandSegment?.name}
        activityId={activityId}
        open={!!demandSegment}
        onOpenChange={(open) => {
          if (!open) setDemandSegment(undefined);
        }}
      />

      <AgendaLineDialog
        open={lineDialogOpen}
        lines={lines}
        segments={segments}
        submitting={lineMutation.isPending}
        onOpenChange={setLineDialogOpen}
        onCreate={({ name, sortOrder }) =>
          lineMutation.mutate({ type: "create", name, sortOrder })
        }
        onUpdate={({ id, name, sortOrder }) =>
          lineMutation.mutate({ type: "update", id, name, sortOrder })
        }
        onDelete={(line) => {
          if (
            window.confirm(
              `确定删除议程线「${lineLabel(line)}」？此操作不可撤销。`,
            )
          ) {
            lineMutation.mutate({ type: "delete", line });
          }
        }}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-semibold text-2xl tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        active
          ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
