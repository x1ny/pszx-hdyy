import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MailPlusIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  TEMPLATE_STATUS_CHIP,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUS_VALUES,
  formatDateTime,
} from "#/features/invitation/labels";
import {
  type InvitationTemplate,
  type InvitationTemplateFormValues,
  type InvitationTemplateStatus,
  createInvitationTemplate,
  deleteInvitationTemplate,
  getInvitationTemplate,
  invitationTemplateKeys,
  invitationTemplateListQueryOptions,
  setInvitationTemplateStatus,
  updateInvitationTemplate,
} from "#/features/invitation/queries";
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
import { TemplateFormDialog } from "./-components/template-form-dialog";
import { TemplatePreviewDialog } from "./-components/template-preview-dialog";

const TemplateSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  status: z.enum(TEMPLATE_STATUS_VALUES).optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/invitation/template/")({
  validateSearch: TemplateSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(invitationTemplateListQueryOptions(deps)),
  component: TemplatePage,
});

const STATUS_FILTER_ITEMS = [
  { value: null, label: "全部状态" },
  ...TEMPLATE_STATUS_VALUES.map((value) => ({
    value,
    label: TEMPLATE_STATUS_LABELS[value],
  })),
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function TemplatePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [nameInput, setNameInput] = useState(search.name ?? "");
  const [statusInput, setStatusInput] = useState<InvitationTemplateStatus | null>(
    search.status ?? null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvitationTemplate>();
  const [previewFileId, setPreviewFileId] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<InvitationTemplate>();

  // URL 变了就把草稿拉回来对齐（后退、粘链接进来）。
  useEffect(() => {
    setNameInput(search.name ?? "");
    setStatusInput(search.status ?? null);
  }, [search.name, search.status]);

  const listQuery = useQuery(invitationTemplateListQueryOptions(search));
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const applyFilter = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: invitationTemplateKeys.all });

  const saveMutation = useMutation({
    mutationFn: (values: InvitationTemplateFormValues) =>
      editing
        ? updateInvitationTemplate({ ...values, id: editing.id })
        : createInvitationTemplate(values),
    onSuccess: () => {
      toast.success(editing ? "修改成功" : "新增成功");
      setFormOpen(false);
      setEditing(undefined);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: (template: InvitationTemplate) =>
      setInvitationTemplateStatus(
        template.id,
        template.status === "enabled" ? "disabled" : "enabled",
      ),
    onSuccess: (updated) => {
      toast.success(updated.status === "enabled" ? "已启用" : "已停用");
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (template: InvitationTemplate) =>
      deleteInvitationTemplate(template.id),
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

  const handleEdit = async (template: InvitationTemplate) => {
    const detail = await getInvitationTemplate(template.id);
    if (!detail) {
      toast.error("模板不存在");
      return;
    }
    setEditing(detail);
    setFormOpen(true);
  };

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailPlusIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">邀请函模板</h1>
            <p className="text-muted-foreground text-sm">
              上传 .docx 作为版式来源；生成邀请函在活动详情的「邀请函」页发起。
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
          新增模板
        </Button>
      </div>

      <FilterBar
        onSubmit={() =>
          applyFilter({
            name: nameInput.trim() || undefined,
            status: statusInput ?? undefined,
          })
        }
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="搜索模板名称"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />
        </div>

        <Select
          items={STATUS_FILTER_ITEMS}
          value={statusInput}
          onValueChange={(value) =>
            setStatusInput(value as InvitationTemplateStatus | null)
          }
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "all"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <FilterActions
          onReset={() => {
            setNameInput("");
            setStatusInput(null);
            navigate({ search: { page: 1, pageSize: search.pageSize } });
          }}
        />
      </FilterBar>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-40">模板名称</TableHead>
              <TableHead className="min-w-40">适用说明</TableHead>
              <TableHead>变量</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
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
                        <MailPlusIcon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的模板</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者上传一份 .docx 新增模板。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((template) => {
                const custom = template.variables.filter(
                  (item) => item.kind === "custom",
                ).length;
                return (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {template.applicableDesc || "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {template.variables.length === 0
                        ? "无"
                        : `${template.variables.length} 个 · ${custom} 个需填写`}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs",
                          TEMPLATE_STATUS_CHIP[template.status],
                        )}
                      >
                        {TEMPLATE_STATUS_LABELS[template.status]}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(template.updatedAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => setPreviewFileId(template.templateFileId)}
                        >
                          预览
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          onClick={() => handleEdit(template)}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          disabled={
                            statusMutation.isPending &&
                            statusMutation.variables?.id === template.id
                          }
                          onClick={() => statusMutation.mutate(template)}
                        >
                          {template.status === "enabled" ? "停用" : "启用"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingDelete(template)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
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
            disabled={search.page <= 1}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })
            }
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rangeEnd >= total}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })
            }
          >
            下一页
          </Button>
        </div>
      </div>

      <TemplateFormDialog
        open={formOpen}
        template={editing}
        submitting={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
      />

      <TemplatePreviewDialog
        open={!!previewFileId}
        templateFileId={previewFileId}
        onOpenChange={(open) => {
          if (!open) setPreviewFileId(undefined);
        }}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该模板？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.name}」将被永久删除，该操作不可恢复。已经用它生成
              过邀请函的模板不能删除，只能停用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
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
