import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderKanbanIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { Field, FieldGroup, FieldLabel } from "#/shared/components/ui/field.tsx";
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
import { ProjectFormDialog } from "./-components/project-form-dialog";
import {
  type Project,
  type ProjectFormValues,
  type ProjectListItem,
  type ProjectPublishStatus,
  createProject,
  deleteProject,
  projectKeys,
  projectListQueryOptions,
  setProjectPublishStatus,
  updateProject,
} from "./-queries";
import {
  formatBudget,
  formatDateTime,
  PUBLISH_STATUS_CHIP,
  PUBLISH_STATUS_LABELS,
  PUBLISH_STATUS_VALUES,
} from "./-utils";

// 筛选条件放 URL，不放 useState——见 supplier/index.tsx 顶部的同一段说明。
const ProjectSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  publishStatus: z.enum(PUBLISH_STATUS_VALUES).optional().catch(undefined),
  startTime: z.iso.date().optional().catch(undefined),
  endTime: z.iso.date().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/project/list")({
  validateSearch: ProjectSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(projectListQueryOptions(deps)),
  component: ProjectListPage,
});

const PUBLISH_STATUS_FILTER_ITEMS = [
  { value: null, label: "全部" },
  ...PUBLISH_STATUS_VALUES.map((value) => ({
    value,
    label: PUBLISH_STATUS_LABELS[value],
  })),
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function ProjectListPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [keywordInput, setKeywordInput] = useState(search.name ?? "");
  const [publishStatusInput, setPublishStatusInput] = useState<
    ProjectPublishStatus | null
  >(search.publishStatus ?? null);
  const [startTimeInput, setStartTimeInput] = useState(search.startTime ?? "");
  const [endTimeInput, setEndTimeInput] = useState(search.endTime ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectListItem>();
  const [pendingDelete, setPendingDelete] = useState<ProjectListItem>();

  useEffect(() => {
    setKeywordInput(search.name ?? "");
    setPublishStatusInput(search.publishStatus ?? null);
    setStartTimeInput(search.startTime ?? "");
    setEndTimeInput(search.endTime ?? "");
  }, [search.name, search.publishStatus, search.startTime, search.endTime]);

  const listQuery = useQuery(projectListQueryOptions(search));
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const applyFilter = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: projectKeys.all });

  const saveMutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      editing ? updateProject({ ...values, id: editing.id }) : createProject(values),
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const publishStatusMutation = useMutation({
    mutationFn: ({
      project,
      publishStatus,
    }: {
      project: Project;
      publishStatus: ProjectPublishStatus;
    }) => setProjectPublishStatus(project.id, publishStatus),
    onSuccess: () => {
      toast.success("发布状态已更新");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (project: ProjectListItem) => deleteProject(project.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      invalidate();
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
            <FolderKanbanIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">项目管理</h1>
            <p className="text-muted-foreground text-sm">
              一个项目下可以有多场活动，点进项目查看和管理它的活动列表。
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
          新增项目
        </Button>
      </div>

      <form
        className="rounded-lg border bg-card p-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            startTimeInput &&
            endTimeInput &&
            startTimeInput > endTimeInput
          ) {
            toast.error("结束时间不能早于开始时间");
            return;
          }
          applyFilter({
            name: keywordInput.trim() || undefined,
            publishStatus: publishStatusInput ?? undefined,
            startTime: startTimeInput || undefined,
            endTime: endTimeInput || undefined,
          });
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-semibold">查询条件</h2>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setKeywordInput("");
                setPublishStatusInput(null);
                setStartTimeInput("");
                setEndTimeInput("");
                navigate({ search: { page: 1, pageSize: search.pageSize } });
              }}
            >
              重置
            </Button>
            <Button type="submit">查询</Button>
          </div>
        </div>

        <FieldGroup className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="project-keyword"
              className="text-xs text-muted-foreground"
            >
              关键字
            </FieldLabel>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="project-keyword"
                className="pl-8"
                placeholder="请输入关键字"
                value={keywordInput}
                onChange={(event) => setKeywordInput(event.target.value)}
              />
            </div>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="project-publish-status"
              className="text-xs text-muted-foreground"
            >
              项目状态
            </FieldLabel>
            <Select
              items={PUBLISH_STATUS_FILTER_ITEMS}
              value={publishStatusInput}
              onValueChange={(value) =>
                setPublishStatusInput(value as ProjectPublishStatus | null)
              }
            >
              <SelectTrigger id="project-publish-status" className="w-full">
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
              htmlFor="project-start-time"
              className="text-xs text-muted-foreground"
            >
              开始时间
            </FieldLabel>
            <Input
              id="project-start-time"
              type="date"
              value={startTimeInput}
              onChange={(event) => setStartTimeInput(event.target.value)}
            />
          </Field>

          <Field className="gap-1.5">
            <FieldLabel
              htmlFor="project-end-time"
              className="text-xs text-muted-foreground"
            >
              结束时间
            </FieldLabel>
            <Input
              id="project-end-time"
              type="date"
              value={endTimeInput}
              onChange={(event) => setEndTimeInput(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </form>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-40">项目名称</TableHead>
              <TableHead>项目地点</TableHead>
              <TableHead>时间范围</TableHead>
              <TableHead>总预算</TableHead>
              <TableHead className="text-center">活动数</TableHead>
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
                        <FolderKanbanIcon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的项目</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者新增一个项目。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/project/$projectId"
                      params={{ projectId: String(project.id) }}
                      className="text-primary hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell>{project.location || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {project.startTime || project.endTime
                      ? `${formatDateTime(project.startTime)} ~ ${formatDateTime(project.endTime)}`
                      : "未排期"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBudget(project.totalBudget)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {project.activityCount}
                  </TableCell>
                  <TableCell>
                    <StatusSelect
                      value={project.publishStatus}
                      values={PUBLISH_STATUS_VALUES}
                      labels={PUBLISH_STATUS_LABELS}
                      chipClass={PUBLISH_STATUS_CHIP}
                      disabled={
                        publishStatusMutation.isPending &&
                        publishStatusMutation.variables?.project.id ===
                          project.id
                      }
                      onChange={(value) =>
                        publishStatusMutation.mutate({
                          project,
                          publishStatus: value,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(project.createdAt)}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => {
                          setEditing(project);
                          setFormOpen(true);
                        }}
                      >
                        修改
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setPendingDelete(project)}
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

      <ProjectFormDialog
        open={formOpen}
        project={editing}
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
            <AlertDialogTitle>确认删除该项目？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.name}」将被永久删除。已有活动或其他业务数据引用的项目不能删除，
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

/**
 * 三态发布状态的快捷变更控件。跟供应商模块那种二态启用/停用按钮不一样——
 * 三个取值没法用一个"取反"按钮表达，用下拉选择，选中即提交目标值
 * （不是取反，语义见 modules/project/validation.ts 的 SetXxxStatusInput
 * 注释）。$projectId.tsx 里活动的发布状态复用同一个组件。
 */
export function StatusSelect<T extends string>({
  value,
  values,
  labels,
  chipClass,
  disabled,
  onChange,
}: {
  value: T;
  values: readonly T[];
  labels: Record<T, string>;
  chipClass: Record<T, string>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Select
      items={labels}
      value={value}
      disabled={disabled}
      onValueChange={(next) => next && next !== value && onChange(next)}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          // 下拉箭头图标在 select.tsx 里写死了 text-muted-foreground，跟色块
          // 徽章的彩色文字对不上（比如绿底绿字的"已上架"配一个灰箭头）。
          // [&_svg]:text-current 靠更高的选择器特异性压过图标自身那个类，
          // 让箭头跟随这里的文字颜色——只在这个彩色小徽章场景这么做，
          // 不动 select.tsx 本身：普通筛选下拉的箭头就该是低调的灰色，
          // 不该跟着占位文字或选中值的颜色走。
          "h-7 w-auto gap-1 rounded-full border px-2.5 font-medium text-xs shadow-none [&_svg]:text-current",
          chipClass[value],
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {labels[item]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
