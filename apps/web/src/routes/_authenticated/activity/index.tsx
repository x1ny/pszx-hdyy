import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  ActivityFormDialog,
  type ActivityFormSubmitValues,
} from "#/features/project/activity-form-dialog";
import {
  type Activity,
  type ActivityType,
  activityKeys,
  activityListQueryOptions,
  createActivity,
  deleteActivity,
  type ProjectPublishStatus,
  projectKeys,
  projectOptionsQueryOptions,
  setActivityPublishStatus,
  updateActivity,
} from "#/features/project/queries";
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_VALUES,
  formatDateTime,
  PUBLISH_STATUS_CHIP,
  PUBLISH_STATUS_LABELS,
  PUBLISH_STATUS_VALUES,
} from "#/features/project/utils";
import {
  FilterActions,
  FilterBar,
  isSameFilter,
} from "#/shared/components/filter-bar.tsx";
import { StatusSelect } from "#/shared/components/status-select.tsx";
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
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "#/shared/components/ui/field.tsx";
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

// 筛选条件放 URL，不放 useState——见 supplier/index.tsx 顶部的同一段说明。
const ActivitySearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  projectId: z.number().int().positive().optional().catch(undefined),
  activityType: z.enum(ACTIVITY_TYPE_VALUES).optional().catch(undefined),
  publishStatus: z.enum(PUBLISH_STATUS_VALUES).optional().catch(undefined),
  startTime: z.iso.date().optional().catch(undefined),
  endTime: z.iso.date().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

/**
 * 一级菜单「活动管理」：跨项目的活动增删改查。
 *
 * 它和项目详情页的「活动列表」标签页（project/$projectId.index.tsx）是**同一份
 * 数据的两个入口**，不是两套功能——同一条 /api/activity/list，同一个表单弹窗，
 * 同一套发布状态控件。差别只有两处：这里多一个「所属项目」筛选和列，新增时
 * 要自己选项目（那边的项目来自路径）。
 *
 * 两个入口都留着，是因为它们对应两种真实的工作方式：筹备一个项目时按项目看；
 * 临到活动当天，运营记得的是活动名，不记得它挂在哪个项目下。
 */
export const Route = createFileRoute("/_authenticated/activity/")({
  validateSearch: ActivitySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(activityListQueryOptions(deps)),
      context.queryClient.ensureQueryData(projectOptionsQueryOptions()),
    ]),
  component: ActivityListPage,
});

const ACTIVITY_TYPE_FILTER_ITEMS = [
  { value: null, label: "全部活动类型" },
  ...ACTIVITY_TYPE_VALUES.map((value) => ({
    value,
    label: ACTIVITY_TYPE_LABELS[value],
  })),
];

const PUBLISH_STATUS_FILTER_ITEMS = [
  { value: null, label: "全部" },
  ...PUBLISH_STATUS_VALUES.map((value) => ({
    value,
    label: PUBLISH_STATUS_LABELS[value],
  })),
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function ActivityListPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [projectIdInput, setProjectIdInput] = useState<number | null>(
    search.projectId ?? null,
  );
  const [activityTypeInput, setActivityTypeInput] =
    useState<ActivityType | null>(search.activityType ?? null);
  const [publishStatusInput, setPublishStatusInput] =
    useState<ProjectPublishStatus | null>(search.publishStatus ?? null);
  const [startTimeInput, setStartTimeInput] = useState(search.startTime ?? "");
  const [endTimeInput, setEndTimeInput] = useState(search.endTime ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Activity>();
  const [pendingDelete, setPendingDelete] = useState<Activity>();

  // URL 变了就把草稿拉回来对齐（后退、粘链接进来）。
  useEffect(() => {
    setNameInput(search.name ?? "");
    setProjectIdInput(search.projectId ?? null);
    setActivityTypeInput(search.activityType ?? null);
    setPublishStatusInput(search.publishStatus ?? null);
    setStartTimeInput(search.startTime ?? "");
    setEndTimeInput(search.endTime ?? "");
  }, [
    search.name,
    search.projectId,
    search.activityType,
    search.publishStatus,
    search.startTime,
    search.endTime,
  ]);

  const listQuery = useQuery(activityListQueryOptions(search));
  const projectOptionsQuery = useQuery(projectOptionsQueryOptions());

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const projectOptions = projectOptionsQuery.data ?? [];

  const projectFilterItems = [
    { value: null, label: "全部" },
    ...projectOptions.map((option) => ({
      value: option.id,
      label: option.name,
    })),
  ];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: activityKeys.all });

  const applyFilter = (patch: Partial<typeof search>) => {
    const next = { ...search, ...patch, page: 1 };
    // 条件没变时 navigate 是空操作，显式重拉一次，让「查询」同时承担刷新
    // 语义（理由见 filter-bar.tsx）。
    if (isSameFilter(search, next)) return invalidate();
    navigate({ search: next });
  };

  const saveMutation = useMutation({
    mutationFn: ({ projectId, ...values }: ActivityFormSubmitValues) => {
      if (editing) return updateActivity({ ...values, id: editing.id });
      // 表单在传了 projectOptions 时把「所属项目」校验成必填，这里兜一次底：
      // 类型上它仍是可选的（项目详情页那个入口不收集这个字段）。
      if (!projectId) throw new Error("请选择所属项目");
      return createActivity({ ...values, projectId });
    },
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidate();
      // 项目列表那一列的「活动数」跟着变了，一起失效。
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
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
      invalidate();
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
      invalidate();
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (error) => toast.error(error.message),
  });

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);
  const hasPrev = search.page > 1;
  const hasNext = rangeEnd < total;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">活动管理</h1>
            <p className="text-muted-foreground text-sm">
              跨项目查看所有活动，点击活动进入活动详情配置页。
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          <PlusIcon />
          新增活动
        </Button>
      </div>

      {/* 筛选项多，排成两行的卡片而不是一条横栏——写法和项目列表一致。 */}
      <FilterBar
        className="flex-col items-stretch gap-4 p-4"
        onSubmit={() => {
          if (startTimeInput && endTimeInput && startTimeInput > endTimeInput) {
            toast.error("结束时间不能早于开始时间");
            return;
          }
          applyFilter({
            name: nameInput.trim() || undefined,
            projectId: projectIdInput ?? undefined,
            activityType: activityTypeInput ?? undefined,
            publishStatus: publishStatusInput ?? undefined,
            startTime: startTimeInput || undefined,
            endTime: endTimeInput || undefined,
          });
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-semibold">查询条件</h2>
          <FilterActions
            onReset={() => {
              setNameInput("");
              setProjectIdInput(null);
              setActivityTypeInput(null);
              setPublishStatusInput(null);
              setStartTimeInput("");
              setEndTimeInput("");
              navigate({ search: { page: 1, pageSize: search.pageSize } });
            }}
          />
        </div>

        <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="activity-keyword"
              className="text-xs text-muted-foreground"
            >
              关键字
            </FieldLabel>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="activity-keyword"
                className="pl-8"
                placeholder="请输入关键字"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
              />
            </div>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="activity-project"
              className="text-xs text-muted-foreground"
            >
              所属项目
            </FieldLabel>
            <Select
              items={projectFilterItems}
              value={projectIdInput}
              onValueChange={(value) =>
                setProjectIdInput(value as number | null)
              }
            >
              <SelectTrigger id="activity-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projectFilterItems.map((item) => (
                  <SelectItem key={item.value ?? "all"} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="activity-type"
              className="text-xs text-muted-foreground"
            >
              活动类型
            </FieldLabel>
            <Select
              items={ACTIVITY_TYPE_FILTER_ITEMS}
              value={activityTypeInput}
              onValueChange={(value) =>
                setActivityTypeInput(value as ActivityType | null)
              }
            >
              <SelectTrigger id="activity-type" className="w-full">
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
          </Field>

          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="activity-publish-status"
              className="text-xs text-muted-foreground"
            >
              发布状态
            </FieldLabel>
            <Select
              items={PUBLISH_STATUS_FILTER_ITEMS}
              value={publishStatusInput}
              onValueChange={(value) =>
                setPublishStatusInput(value as ProjectPublishStatus | null)
              }
            >
              <SelectTrigger id="activity-publish-status" className="w-full">
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
          </Field>

          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="activity-start-time"
              className="text-xs text-muted-foreground"
            >
              开始时间
            </FieldLabel>
            <Input
              id="activity-start-time"
              type="date"
              value={startTimeInput}
              onChange={(event) => setStartTimeInput(event.target.value)}
            />
          </Field>

          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="activity-end-time"
              className="text-xs text-muted-foreground"
            >
              结束时间
            </FieldLabel>
            <Input
              id="activity-end-time"
              type="date"
              value={endTimeInput}
              onChange={(event) => setEndTimeInput(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-40">活动名称</TableHead>
              <TableHead>所属项目</TableHead>
              <TableHead>活动类型</TableHead>
              <TableHead>时间范围</TableHead>
              <TableHead className="text-center">环节数</TableHead>
              <TableHead>发布状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
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
                      <EmptyTitle>没有匹配的活动</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者新增一场活动。
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
                        projectId: String(activity.projectId),
                        activityId: String(activity.id),
                      }}
                      // 告诉详情页"从活动管理进来的"，它据此把左上角的返回
                      // 指回这里而不是项目详情（见那个文件里的 from 注释）。
                      search={{ from: "activity" }}
                      className="text-primary hover:underline"
                    >
                      {activity.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/project/$projectId"
                      params={{ projectId: String(activity.projectId) }}
                      className="hover:underline"
                    >
                      {activity.projectName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {ACTIVITY_TYPE_LABELS[activity.activityType]}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(activity.startTime)} ~{" "}
                    {formatDateTime(activity.endTime)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {activity.segmentCount}
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
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(activity.createdAt)}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        to="/project/$projectId/activity/$activityId"
                        params={{
                          projectId: String(activity.projectId),
                          activityId: String(activity.id),
                        }}
                        search={{ from: "activity" }}
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
                          setEditing(activity);
                          setFormOpen(true);
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
            onValueChange={(value) => applyFilter({ pageSize: Number(value) })}
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
              navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })
            }
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })
            }
          >
            下一页
          </Button>
        </div>
      </div>

      <ActivityFormDialog
        open={formOpen}
        activity={editing}
        projectOptions={projectOptions}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
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
              「{pendingDelete?.name}
              」将被永久删除。已有议程、人员、资源或邀请函等业务数据引用的活动不能删除，
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
    </div>
  );
}
