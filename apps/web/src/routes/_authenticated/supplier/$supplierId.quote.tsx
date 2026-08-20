import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  FileTextIcon,
  Loader2Icon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { fileUrl, uploadFile } from "#/features/file/queries";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
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
  createSupplierQuote,
  deleteSupplierQuote,
  type SupplierQuote,
  supplierDetailQueryOptions,
  supplierQuoteKeys,
  supplierQuoteListQueryOptions,
} from "./-queries";
import {
  CATEGORY_BADGE_CLASS,
  categoryLabel,
  fileExtension,
  formatDateTime,
  formatFileSize,
  SUPPLIER_STATUS_CHIP,
  SUPPLIER_STATUS_LABELS,
} from "./-utils";

export const Route = createFileRoute(
  "/_authenticated/supplier/$supplierId/quote",
)({
  loader: ({ context, params }) => {
    const supplierId = Number(params.supplierId);
    // 两条都预取：标题栏和附件表同时出现，只取一条会让页面先缺一半。
    return Promise.all([
      context.queryClient.ensureQueryData(
        supplierDetailQueryOptions(supplierId),
      ),
      context.queryClient.ensureQueryData(
        supplierQuoteListQueryOptions(supplierId),
      ),
    ]);
  },
  component: SupplierQuotePage,
});

/**
 * 供应商报价信息。
 *
 * **这一页不录入报价，只管附件。** 报价单是供应商发来的 PDF / Excel，金额、
 * 有效期、明细都在文件里；做成结构化表单等于让运营把文件内容再录一遍，两边
 * 必然对不上（同 modules/supplier/schema.ts 里 supplierQuote 的注释）。
 *
 * 做成独立页面而不是弹窗：地址栏里带着 supplierId，这一页可以直接分享给同事；
 * 附件列表本身也可能很长，塞进弹窗就变成一个带滚动条的小窗口。
 */
function SupplierQuotePage() {
  const { supplierId: supplierIdParam } = Route.useParams();
  const supplierId = Number(supplierIdParam);
  const queryClient = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<SupplierQuote>();

  const supplierQuery = useQuery(supplierDetailQueryOptions(supplierId));
  const listQuery = useQuery(supplierQuoteListQueryOptions(supplierId));

  const supplier = supplierQuery.data;
  const list = listQuery.data ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: supplierQuoteKeys.all });

  /**
   * 上传和挂载是一个动作的两半，串在一个 mutation 里。
   *
   * 分成两步会留下「文件传上去了但没挂到供应商名下」的孤儿：那个 file_asset
   * 行已经存在，用户却在列表上看不到任何东西，也不知道该重传还是该刷新。
   */
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const uploaded = await uploadFile(file);
      return createSupplierQuote({ supplierId, fileId: uploaded.id });
    },
    onSuccess: (quote) => {
      toast.success(`已上传「${quote.fileName}」`);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (quote: SupplierQuote) => deleteSupplierQuote(quote.id),
    onSuccess: () => {
      toast.success("删除成功");
      setPendingDelete(undefined);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <Link
          to="/supplier"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 mb-2",
          )}
        >
          <ArrowLeftIcon />
          返回供应商管理
        </Link>

        {!supplier ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-semibold text-xl tracking-tight">
                  {supplier.name} · 报价信息
                </h1>
                <Badge
                  variant="outline"
                  className={cn("border", SUPPLIER_STATUS_CHIP[supplier.status])}
                >
                  {SUPPLIER_STATUS_LABELS[supplier.status]}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {supplier.city} · {supplier.contactPerson} ·{" "}
                <span className="tabular-nums">{supplier.contactPhone}</span>
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {supplier.serviceCategories.map((category) => (
                  <Badge
                    key={category}
                    className={CATEGORY_BADGE_CLASS[category]}
                  >
                    {categoryLabel(category)}
                  </Badge>
                ))}
              </div>
            </div>

            <Button
              disabled={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadMutation.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <UploadIcon />
              )}
              上传报价文件
            </Button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 清空 value，否则连续选同一个文件不会再触发 change。
          event.target.value = "";
          if (file) uploadMutation.mutate(file);
        }}
      />

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-64">文件名称</TableHead>
              <TableHead>上传人员</TableHead>
              <TableHead>上传时间</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isPending ? (
              Array.from({ length: 3 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有身份
                <TableRow key={index}>
                  {Array.from({ length: 4 }, (_, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FileTextIcon />
                      </EmptyMedia>
                      <EmptyTitle>还没有报价文件</EmptyTitle>
                      <EmptyDescription>
                        把供应商发来的报价单传上来，之后随时可以查看和下载。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((quote) => (
                <QuoteRow
                  key={quote.id}
                  quote={quote}
                  deleting={
                    deleteMutation.isPending &&
                    deleteMutation.variables?.id === quote.id
                  }
                  onDelete={() => setPendingDelete(quote)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该报价文件？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.fileName}
              」将从该供应商的报价信息中移除，该操作不可恢复。
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

function QuoteRow({
  quote,
  deleting,
  onDelete,
}: {
  quote: SupplierQuote;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          <span className="inline-flex shrink-0 items-center rounded border bg-muted px-1.5 py-0.5 font-semibold text-[10px] text-muted-foreground">
            {fileExtension(quote.fileName)}
          </span>
          <span className="break-all">{quote.fileName}</span>
          <span className="shrink-0 whitespace-nowrap text-muted-foreground text-xs">
            {formatFileSize(quote.sizeBytes)}
          </span>
        </div>
      </TableCell>
      <TableCell>{quote.uploadedByName ?? "-"}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDateTime(quote.createdAt)}
      </TableCell>
      {/* 操作列居中 + inline-flex gap-1，同供应商列表（见 docs/crud-page-guide.md）。 */}
      <TableCell className="whitespace-nowrap text-center">
        <div className="inline-flex items-center gap-1">
          {/* 下载是 <a> 而不是走 mutation：浏览器原生下载，不用把整份文件先读进
              内存再造 blob URL。链接套 buttonVariants，跟旁边的删除按钮共用同一
              套尺寸和配色。

              **没有「查看」。** 报价单大多是 Word/Excel，浏览器本来就渲染不了，
              点下去只会变成一次静默下载——那和旁边的「下载」重复，用户还会以为
              按钮坏了；PDF 单独开一条预览通道又会让同一列的按钮时有时无。 */}
          <a
            href={fileUrl(quote.fileId, true)}
            download={quote.fileName}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "text-primary hover:text-primary",
            )}
          >
            下载
          </a>

          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={deleting}
            onClick={onDelete}
          >
            删除
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
