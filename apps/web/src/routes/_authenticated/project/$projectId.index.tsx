import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { FilterActions, FilterBar } from "#/shared/components/filter-bar.tsx";
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
import {
  Button,
  buttonVariants,
} from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
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
import {
  ActivityFormDialog,
  type ActivityFormSubmitValues,
} from "./-components/activity-form-dialog";
import { StatusSelect } from "./list";
import {
  type Activity,
  type ActivityType,
  type ProjectPublishStatus,
  activityKeys,
  activityListQueryOptions,
  createActivity,
  deleteActivity,
  setActivityPublishStatus,
  updateActivity,
} from "./-queries";
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_VALUES,
  formatBudget,
  formatDateTime,
  PUBLISH_STATUS_CHIP,
  PUBLISH_STATUS_LABELS,
  PUBLISH_STATUS_VALUES,
} from "./-utils";

const ActivitySearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  activityType: z.enum(ACTIVITY_TYPE_VALUES).optional().catch(undefined),
  publishStatus: z.enum(PUBLISH_STATUS_VALUES).optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

// 活动列表是项目详情的默认标签页。
//
// 筛选条件写在这里而不是父布局的 validateSearch 上：两个标签页的 schema 都有
// name / page / pageSize，同名不同义。挂在父布局上就成了一份共享的 search，
// 在项目人员页搜"张"再切回活动列表，会变成按"张"筛活动。分到各自的子路由后
// 互不可见（切换时对方的参数直接不带过去），这个串台就不可能发生。
//
// 代价是切走再切回筛选会重置——可接受，标签页切换本来就是换一件事做。
export const Route = createFileRoute("/_authenticated/project/$projectId/")({
  validateSearch: ActivitySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      activityListQueryOptions({ ...deps, projectId: Number(params.projectId) }),
    ),
  component: ProjectActivityListPage,
});

const ACTIVITY_TYPE_FILTER_ITEMS = [
  { value: null, label: "全部活动类型" },
  ...ACTIVITY_TYPE_VALUES.map((value) => ({
    value,
    label: ACTIVITY_TYPE_LABELS[value],
  })),
];

const PUBLISH_STATUS_FILTER_ITEMS = [
  { value: null, label: "全部发布状态" },
  ...PUBLISH_STATUS_VALUES.map((value) => ({
    value,
    label: PUBLISH_STATUS_LABELS[value],
  })),
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function ProjectActivityListPage() {
  const { projectId: projectIdParam } = Route.useParams();
  const projectId = Number(projectIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [activityTypeInput, setActivityTypeInput] = useState<ActivityType | null>(
    search.activityType ?? null,
  );
  const [publishStatusInput, setPublishStatusInput] =
    useState<ProjectPublishStatus | null>(search.publishStatus ?? null);
  const [activityFormOpen, setActivityFormOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity>();
  const [pendingDelete, setPendingDelete] = useState<Activity>();

  // URL 变了就把草稿拉回来对齐（后退、粘链接进来）。
  useEffect(() => {
    setNameInput(search.name ?? "");
    setActivityTypeInput(search.activityType ?? null);
    setPublishStatusInput(search.publishStatus ?? null);
  }, [search.name, search.activityType, search.publishStatus]);

  const activityListQuery = useQuery(
    activityListQueryOptions({ ...search, projectId }),
  );

  const list = activityListQuery.data?.list ?? [];
  const total = activityListQuery.data?.total ?? 0;

  const applyFilter = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });

  const invalidateActivities = () =>
    queryClient.invalidateQueries({ queryKey: activityKeys.all });

  const saveActivityMutation = useMutation({
    // 表单只交出共同字段（没有 id，也没有 projectId——见
    // activity-form-dialog.tsx 里 ActivityFormSubmitValues 的注释）；
    // 新增时在这里补 projectId（来自当前页面路径），编辑时补 id，
    // 不在表单层面处理，避免两种场景拼出两套不同形状的输入类型。
    mutationFn: (values: ActivityFormSubmitValues) =>
      editingActivity
        ? updateActivity({ ...values, id: editingActivity.id })
        : createActivity({ ...values, projectId }),
    onSuccess: () => {
      toast.success(editingActivity ? "修改成功" : "新增成功");
      setActivityFormOpen(false);
      setEditingActivity(undefined);
      invalidateActivities();
    },
    onError: (error) => toast.error(error.message),
  });

  const publishStatusMutation = useMutation({
    mutationFn: ({
      activity,
      publishStatus,
    }: {
      activity: Activity;
      publishStatus: Activity["publishStatus"];
    }) => setActivityPublishStatus(activity.id, publishStatus),
    onSuccess: () => {
      toast.success("发布状态已更新");
      invalidateActivities();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (activity: Activity) => deleteActivity(activity.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      // 删掉当前页最后一条时退回上一页，否则会停在一张空表上。
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      invalidateActivities();
    },
    onError: (error) => toast.error(error.message),
  });

  // 展示开关和报名开关的 mutation 随那两列一起去掉了（见表格里的注释）。
  // queries.ts 里的 setActivityDisplayEnabled/setActivityRegistrationEnabled
  // 和后端接口都保留着，H5 上马时直接接回来。

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);
  const hasPrev = search.page > 1;
  const hasNext = rangeEnd < total;

  return (
    <>
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">活动列表</h2>
          <p className="text-muted-foreground text-sm">
            这个项目下的所有活动。环节、场地、资源、排位等能力还没有建设，
            这里先只维护活动的基础信息和上下架状态。
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingActivity(undefined);
            setActivityFormOpen(true);
          }}
        >
          <PlusIcon />
          新增活动
        </Button>
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            name: nameInput.trim() || undefined,
            activityType: activityTypeInput ?? undefined,
            publishStatus: publishStatusInput ?? undefined,
          })
        }
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="搜索活动名称"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />
        </div>

        <Select
          items={ACTIVITY_TYPE_FILTER_ITEMS}
          value={activityTypeInput}
          onValueChange={(value) =>
            setActivityTypeInput(value as ActivityType | null)
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_TYPE_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "all"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={PUBLISH_STATUS_FILTER_ITEMS}
          value={publishStatusInput}
          onValueChange={(value) =>
            setPublishStatusInput(value as ProjectPublishStatus | null)
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PUBLISH_STATUS_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "all"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <FilterActions
          onReset={() => {
            setNameInput("");
            setActivityTypeInput(null);
            setPublishStatusInput(null);
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-40">活动名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>时间范围</TableHead>
              <TableHead>预算</TableHead>
              <TableHead>发布状态</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activityListQuery.isPending ? (
              Array.from({ length: 3 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                <TableRow key={index}>
                  {Array.from({ length: 6 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CalendarIcon />
                      </EmptyMedia>
                      <EmptyTitle>还没有活动</EmptyTitle>
                      <EmptyDescription>
                        点击右上角"新增活动"创建这个项目下的第一场活动。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((activity) => (
                  <TableRow key={activity.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/project/$projectId/activity/$activityId"
                        params={{
                          projectId: projectIdParam,
                          activityId: String(activity.id),
                        }}
                        className="text-primary hover:underline"
                      >
                        {activity.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {ACTIVITY_TYPE_LABELS[activity.activityType]}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(activity.startTime)} ~{" "}
                      {formatDateTime(activity.endTime)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatBudget(activity.totalBudget)}
                    </TableCell>
                    <TableCell>
                      <StatusSelect
                        value={activity.publishStatus}
                        values={PUBLISH_STATUS_VALUES}
                        labels={PUBLISH_STATUS_LABELS}
                        chipClass={PUBLISH_STATUS_CHIP}
                        disabled={
                          publishStatusMutation.isPending &&
                          publishStatusMutation.variables?.activity.id ===
                            activity.id
                        }
                        onChange={(value) =>
                          publishStatusMutation.mutate({
                            activity,
                            publishStatus: value,
                          })
                        }
                      />
                    </TableCell>
                    {/* H5 展示开关和报名开关两列本期隐藏：两个都只控制 H5 的
                        行为，而 H5 不建（AGENTS.md）。活动详情页也一并去掉了
                        这两个芯片，两处口径要一致——只在其中一处留着，用户会
                        以为另一处漏了。字段、接口和编辑表单都还在。 */}
                    <TableCell className="text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          to="/project/$projectId/activity/$activityId"
                          params={{
                            projectId: projectIdParam,
                            activityId: String(activity.id),
                          }}
                          className={cn(
                            buttonVariants({ variant: "ghost", size: "sm" }),
                            "text-primary hover:text-primary",
                          )}
                        >
                          详情
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => {
                            setEditingActivity(activity);
                            setActivityFormOpen(true);
                          }}
                        >
                          修改
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingDelete(activity)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">
          第 {rangeStart}-{rangeEnd} 条 / 共 {total} 条
        </span>
        <div className="flex items-center gap-2">
          <Select
            items={PAGE_SIZE_OPTIONS.map((size) => ({
              value: size,
              label: `${size} 条/页`,
            }))}
            value={search.pageSize}
            onValueChange={(value) =>
              applyFilter({ pageSize: Number(value) })
            }
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={size}>
                  {size} 条/页
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev}
            onClick={() =>
              navigate({
                search: (prev) => ({ ...prev, page: prev.page - 1 }),
              })
            }
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() =>
              navigate({
                search: (prev) => ({ ...prev, page: prev.page + 1 }),
              })
            }
          >
            下一页
          </Button>
        </div>
      </div>
    </div>

      <ActivityFormDialog
        open={activityFormOpen}
        activity={editingActivity}
        submitting={saveActivityMutation.isPending}
        onOpenChange={(open) => {
          setActivityFormOpen(open);
          if (!open) setEditingActivity(undefined);
        }}
        onSubmit={(values) => saveActivityMutation.mutate(values)}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该活动？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.name}」将被永久删除。已有议程、人员、资源或邀请函等业务数据引用的活动不能删除，
              请改为下架。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                pendingDelete && deleteMutation.mutate(pendingDelete)
              }
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
