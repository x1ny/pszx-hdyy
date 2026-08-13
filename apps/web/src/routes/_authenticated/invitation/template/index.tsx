import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MailPlusIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
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
import { TemplateFormDialog } from "./-components/template-form-dialog";
import { TemplatePreviewDialog } from "./-components/template-preview-dialog";
import {
  type InvitationTemplate,
  type InvitationTemplateFormValues,
  createInvitationTemplate,
  deleteInvitationTemplate,
  getInvitationTemplate,
  invitationTemplateKeys,
  invitationTemplateListQueryOptions,
  setInvitationTemplateStatus,
  updateInvitationTemplate,
} from "./-queries";
import {
  ISSUER_LABELS,
  ISSUER_VALUES,
  TEMPLATE_STATUS_CHIP,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUS_VALUES,
  formatDateTime,
} from "./-utils";

const TemplateSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  issuer: z.enum(ISSUER_VALUES).optional().catch(undefined),
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

const ISSUER_FILTER_ITEMS = [
  { value: null, label: "全部发函主体" },
  ...ISSUER_VALUES.map((value) => ({ value, label: ISSUER_LABELS[value] })),
];

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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvitationTemplate>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<InvitationTemplate>();
  const [pendingDelete, setPendingDelete] = useState<InvitationTemplate>();

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

  const handlePreview = async (template: InvitationTemplate) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewTemplate(undefined);
    try {
      const detail = await getInvitationTemplate(template.id);
      if (!detail) {
        toast.error("模板不存在");
        setPreviewOpen(false);
        return;
      }
      setPreviewTemplate(detail);
    } finally {
      setPreviewLoading(false);
    }
  };

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);
  const hasPrev = search.page > 1;
  const hasNext = rangeEnd < total;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailPlusIcon className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold text-xl tracking-tight">邀请函模板管理</h1>
            <p className="text-muted-foreground text-sm">
              维护邀请函正文、附则、联系方式等可复用的模板。
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
            placeholder="搜索模板名称"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />
        </form>

        <Select
          items={ISSUER_FILTER_ITEMS}
          value={search.issuer ?? null}
          onValueChange={(value) => applyFilter({ issuer: value ?? undefined })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ISSUER_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "all"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={STATUS_FILTER_ITEMS}
          value={search.status ?? null}
          onValueChange={(value) => applyFilter({ status: value ?? undefined })}
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
              <TableHead className="min-w-40">模板名称</TableHead>
              <TableHead>发函主体</TableHead>
              <TableHead className="min-w-40">适用说明</TableHead>
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
                        换个筛选条件，或者新增一个模板。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>{ISSUER_LABELS[template.issuer]}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {template.applicableDesc || "-"}
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
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        to="/invitation/generate"
                        search={{ templateId: template.id }}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                          className: "text-primary hover:text-primary",
                        })}
                      >
                        生成
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => handlePreview(template)}
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
        open={previewOpen}
        loading={previewLoading}
        template={previewTemplate}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) setPreviewTemplate(undefined);
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
              「{pendingDelete?.name}」将被永久删除，该操作不可恢复。
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
