import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  SearchIcon,
  SquareCheckBigIcon,
  SquareIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
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
import { ProjectFormDialog } from "./-components/project-form-dialog";
import { StatusSelect } from "./list";
import {
  type Activity,
  type ProjectFormValues,
  activityKeys,
  activityListQueryOptions,
  createActivity,
  projectDetailQueryOptions,
  projectKeys,
  setActivityDisplayEnabled,
  setActivityPublishStatus,
  setActivityRegistrationEnabled,
  updateActivity,
  updateProject,
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

export const Route = createFileRoute("/_authenticated/project/$projectId")({
  validateSearch: ActivitySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) => {
    const projectId = Number(params.projectId);
    return Promise.all([
      context.queryClient.ensureQueryData(projectDetailQueryOptions(projectId)),
      context.queryClient.ensureQueryData(
        activityListQueryOptions({ ...deps, projectId }),
      ),
    ]);
  },
  component: ProjectDetailPage,
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

function ProjectDetailPage() {
  const { projectId: projectIdParam } = Route.useParams();
  const projectId = Number(projectIdParam);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [activityFormOpen, setActivityFormOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity>();

  const projectQuery = useQuery(projectDetailQueryOptions(projectId));
  const activityListQuery = useQuery(
    activityListQueryOptions({ ...search, projectId }),
  );

  const project = projectQuery.data;
  const list = activityListQuery.data?.list ?? [];
  const total = activityListQuery.data?.total ?? 0;

  const applyFilter = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });

  const invalidateActivities = () =>
    queryClient.invalidateQueries({ queryKey: activityKeys.all });

  const saveProjectMutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      updateProject({ ...values, id: projectId }),
    onSuccess: () => {
      toast.success("修改成功");
      setProjectFormOpen(false);
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (error) => toast.error(error.message),
  });

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

  const displayMutation = useMutation({
    mutationFn: (activity: Activity) =>
      setActivityDisplayEnabled(activity.id, !activity.displayEnabled),
    onSuccess: (updated) => {
      toast.success(updated.displayEnabled ? "已开启展示" : "已关闭展示");
      invalidateActivities();
    },
    onError: (error) => toast.error(error.message),
  });

  const registrationMutation = useMutation({
    mutationFn: (activity: Activity) =>
      setActivityRegistrationEnabled(
        activity.id,
        !activity.registrationEnabled,
      ),
    onSuccess: (updated) => {
      toast.success(updated.registrationEnabled ? "已开启报名" : "已关闭报名");
      invalidateActivities();
    },
    onError: (error) => toast.error(error.message),
  });

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);
  const hasPrev = search.page > 1;
  const hasNext = rangeEnd < total;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <Link
          to="/project/list"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 mb-2",
          )}
        >
          <ArrowLeftIcon />
          返回项目列表
        </Link>

        {!project ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-semibold text-xl tracking-tight">
                    {project.name}
                  </h1>
                  <Badge
                    variant="outline"
                    className={cn("border", PUBLISH_STATUS_CHIP[project.publishStatus])}
                  >
                    {PUBLISH_STATUS_LABELS[project.publishStatus]}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  {project.location || "未填写地点"} ·{" "}
                  {project.startTime || project.endTime
                    ? `${formatDateTime(project.startTime)} ~ ${formatDateTime(project.endTime)}`
                    : "未排期"}
                </p>
              </div>
              <Button variant="outline" onClick={() => setProjectFormOpen(true)}>
                编辑项目信息
              </Button>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <InfoRow label="主办单位">{project.hostOrg || "-"}</InfoRow>
              <InfoRow label="承办单位">{project.organizerOrg || "-"}</InfoRow>
              <InfoRow label="支持单位">{project.supportOrg || "-"}</InfoRow>
              <InfoRow label="指导单位">{project.guidingOrg || "-"}</InfoRow>
              <InfoRow label="总预算">{formatBudget(project.totalBudget)}</InfoRow>
            </dl>

            {project.description && (
              <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
                {project.description}
              </p>
            )}
          </div>
        )}
      </div>

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

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilter({ name: nameInput.trim() || undefined });
            }}
          >
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-56 pl-8"
              placeholder="搜索活动名称"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
            />
          </form>

          <Select
            items={ACTIVITY_TYPE_FILTER_ITEMS}
            value={search.activityType ?? null}
            onValueChange={(value) =>
              applyFilter({ activityType: value ?? undefined })
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
            value={search.publishStatus ?? null}
            onValueChange={(value) =>
              applyFilter({ publishStatus: value ?? undefined })
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

          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              setNameInput("");
              navigate({ search: { page: 1, pageSize: search.pageSize } });
            }}
          >
            重置
          </Button>
        </div>

        <div className="rounded-lg border bg-card shadow-sm">
          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-40">活动名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>时间范围</TableHead>
                <TableHead>预算</TableHead>
                <TableHead>发布状态</TableHead>
                <TableHead>H5 展示</TableHead>
                <TableHead>报名</TableHead>
                <TableHead className="text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activityListQuery.isPending ? (
                Array.from({ length: 3 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                  <TableRow key={index}>
                    {Array.from({ length: 8 }, (_, cell) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                      <TableCell key={cell}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
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
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-muted-foreground hover:text-foreground"
                          disabled={
                            displayMutation.isPending &&
                            displayMutation.variables?.id === activity.id
                          }
                          onClick={() => displayMutation.mutate(activity)}
                        >
                          {activity.displayEnabled ? (
                            <>
                              <EyeIcon className="text-success-foreground" />
                              展示中
                            </>
                          ) : (
                            <>
                              <EyeOffIcon />
                              已隐藏
                            </>
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-muted-foreground hover:text-foreground"
                          disabled={
                            registrationMutation.isPending &&
                            registrationMutation.variables?.id === activity.id
                          }
                          onClick={() => registrationMutation.mutate(activity)}
                        >
                          {activity.registrationEnabled ? (
                            <>
                              <SquareCheckBigIcon className="text-success-foreground" />
                              可报名
                            </>
                          ) : (
                            <>
                              <SquareIcon />
                              已暂停
                            </>
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
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

      {project && (
        <ProjectFormDialog
          open={projectFormOpen}
          project={project}
          submitting={saveProjectMutation.isPending}
          onOpenChange={setProjectFormOpen}
          onSubmit={(values) => saveProjectMutation.mutate(values)}
        />
      )}

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
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
