import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardListIcon, FileTextIcon, SearchIcon } from "lucide-react";
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
import { BatchDetailDialog } from "./-components/batch-detail-dialog";
import {
  type InvitationBatchListItem,
  deleteInvitationBatch,
  getInvitationBatch,
  invitationBatchKeys,
  invitationBatchListQueryOptions,
} from "./-queries";
import { ISSUER_LABELS, ISSUER_VALUES, formatDateTime } from "./-utils";

const BatchSearchSchema = z.object({
  activityId: z.number().optional().catch(undefined),
  templateName: z.string().optional().catch(undefined),
  issuer: z.enum(ISSUER_VALUES).optional().catch(undefined),
  batchNo: z.string().optional().catch(undefined),
  recipientName: z.string().optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/invitation/batch/")({
  validateSearch: BatchSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(invitationBatchListQueryOptions(deps)),
  component: BatchPage,
});

const ISSUER_FILTER_ITEMS = [
  { value: null, label: "全部发函主体" },
  ...ISSUER_VALUES.map((value) => ({ value, label: ISSUER_LABELS[value] })),
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function BatchPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const [templateNameInput, setTemplateNameInput] = useState(search.templateName ?? "");
  const [batchNoInput, setBatchNoInput] = useState(search.batchNo ?? "");
  const [recipientNameInput, setRecipientNameInput] = useState(search.recipientName ?? "");

  const [detailId, setDetailId] = useState<number>();
  const [pendingDelete, setPendingDelete] = useState<InvitationBatchListItem>();

  const listQuery = useQuery(invitationBatchListQueryOptions(search));
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const detailQuery = useQuery({
    queryKey: [...invitationBatchKeys.all, "detail", detailId],
    queryFn: () => getInvitationBatch(detailId as number),
    enabled: detailId !== undefined,
  });

  const applyFilter = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });

  const handleSearch = () =>
    applyFilter({
      templateName: templateNameInput.trim() || undefined,
      batchNo: batchNoInput.trim() || undefined,
      recipientName: recipientNameInput.trim() || undefined,
    });

  const handleReset = () => {
    setTemplateNameInput("");
    setBatchNoInput("");
    setRecipientNameInput("");
    navigate({ search: { page: 1, pageSize: search.pageSize } });
  };

  const deleteMutation = useMutation({
    mutationFn: (batch: InvitationBatchListItem) => deleteInvitationBatch(batch.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      if (list.length === 1 && search.page > 1) {
        navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) });
      }
      queryClient.invalidateQueries({ queryKey: invitationBatchKeys.all });
    },
    onError: (error) => toast.error(error.message),
  });

  const rangeStart = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1;
  const rangeEnd = Math.min(search.page * search.pageSize, total);
  const hasPrev = search.page > 1;
  const hasNext = rangeEnd < total;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileTextIcon className="size-5" />
        </div>
        <div>
          <h1 className="font-semibold text-xl tracking-tight">生成记录</h1>
          <p className="text-muted-foreground text-sm">
            查看已生成的邀请函批次及对应受邀人明细。
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-48 pl-8"
            placeholder="搜索模板名称"
            value={templateNameInput}
            onChange={(event) => setTemplateNameInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleSearch()}
          />
        </div>
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
        <Input
          className="w-40"
          placeholder="搜索批次号"
          value={batchNoInput}
          onChange={(event) => setBatchNoInput(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && handleSearch()}
        />
        <Input
          className="w-40"
          placeholder="搜索受邀人姓名"
          value={recipientNameInput}
          onChange={(event) => setRecipientNameInput(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && handleSearch()}
        />
        <Button size="sm" onClick={handleSearch}>
          筛选
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={handleReset}
        >
          重置
        </Button>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead>批次号</TableHead>
              <TableHead>发函主体</TableHead>
              <TableHead className="min-w-40">模板名称</TableHead>
              <TableHead>生成数量</TableHead>
              <TableHead>发函日期</TableHead>
              <TableHead>生成人</TableHead>
              <TableHead>生成时间</TableHead>
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
                        <ClipboardListIcon />
                      </EmptyMedia>
                      <EmptyTitle>没有匹配的生成记录</EmptyTitle>
                      <EmptyDescription>
                        换个筛选条件，或者去生成一批新的邀请函。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">{batch.batchNo}</TableCell>
                  <TableCell>{ISSUER_LABELS[batch.issuer]}</TableCell>
                  <TableCell>{batch.templateName}</TableCell>
                  <TableCell>{batch.itemCount}</TableCell>
                  <TableCell>{batch.issueDate}</TableCell>
                  <TableCell>{batch.createdByName || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(batch.createdAt)}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => setDetailId(batch.id)}
                      >
                        详情
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setPendingDelete(batch)}
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

      <BatchDetailDialog
        batch={detailQuery.data}
        loading={detailId !== undefined && detailQuery.isPending}
        onOpenChange={(open) => {
          if (!open) setDetailId(undefined);
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
            <AlertDialogTitle>确认删除该生成记录？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.batchNo}」及其全部受邀人明细将被永久删除，该操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
