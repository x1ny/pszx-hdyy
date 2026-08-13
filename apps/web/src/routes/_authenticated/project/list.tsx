import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderKanbanIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "#/shared/components/ui/button.tsx";
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
import { ProjectFormDialog } from "./-components/project-form-dialog";
import {
  type Project,
  type ProjectFormValues,
  type ProjectPublishStatus,
  createProject,
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
  { value: null, label: "全部发布状态" },
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

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project>();

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
            placeholder="搜索项目名称"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />
        </form>

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
              <TableHead className="min-w-40">项目名称</TableHead>
              <TableHead>项目地点</TableHead>
              <TableHead>时间范围</TableHead>
              <TableHead>总预算</TableHead>
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
                  {Array.from({ length: 7 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
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
