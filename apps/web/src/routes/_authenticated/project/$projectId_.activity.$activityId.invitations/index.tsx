import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DownloadIcon, MailPlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatDateTime } from "#/features/invitation/labels";
import {
  type InvitationBatchListItem,
  downloadInvitationBatch,
  invitationBatchListQueryOptions,
  saveBlob,
} from "#/features/invitation/queries";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
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

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/invitations/",
)({
  component: InvitationsPage,
});

const PAGE_SIZE = 10;

/**
 * 活动下的邀请函生成记录。
 *
 * 邀请函没有状态机（BR-DEV-013：不维护业务状态），所以这一页没有「待发送/已发送」
 * 这类流转，只有「谁在什么时候用哪个模板给哪些人生成过」加上下载。
 */
function InvitationsPage() {
  const { projectId, activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);

  const [keywordInput, setKeywordInput] = useState("");
  const [recipientName, setRecipientName] = useState<string>();
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<number>();

  const listQuery = useQuery(
    invitationBatchListQueryOptions({
      activityId,
      recipientName,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const downloadMutation = useMutation({
    mutationFn: (batch: InvitationBatchListItem) =>
      downloadInvitationBatch(batch.id),
    onSuccess: ({ blob, fileName }) => {
      saveBlob(blob, fileName);
      toast.success("已开始下载");
    },
    onError: (error) => toast.error(error.message),
  });

  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">邀请函生成记录</h2>
          <p className="text-muted-foreground text-sm">
            版式来自「邀请函模板」里上传的 .docx，下载为敏感操作，会留下审计记录。
          </p>
        </div>
        <Link
          to="/project/$projectId/activity/$activityId/invitations/generate"
          params={{ projectId, activityId: activityIdParam }}
          className={buttonVariants()}
        >
          <MailPlusIcon />
          生成邀请函
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            setRecipientName(keywordInput.trim() || undefined);
            setPage(1);
          }}
        >
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="按受邀人姓名筛选批次"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
          />
        </form>
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            setKeywordInput("");
            setRecipientName(undefined);
            setPage(1);
          }}
        >
          重置
        </Button>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead>批次号</TableHead>
              <TableHead className="min-w-40">模板</TableHead>
              <TableHead>份数</TableHead>
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
                        <MailPlusIcon />
                      </EmptyMedia>
                      <EmptyTitle>还没有生成过邀请函</EmptyTitle>
                      <EmptyDescription>
                        从活动人员里选人、挑一个模板，就能生成这场活动的邀请函。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              list.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {batch.batchNo}
                  </TableCell>
                  <TableCell>{batch.templateName}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {batch.recordCount} 份
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {batch.issueDate}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {batch.createdByName ?? "-"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(batch.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-center">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => setDetailId(batch.id)}
                      >
                        查看名单
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        disabled={
                          batch.recordCount === 0 ||
                          (downloadMutation.isPending &&
                            downloadMutation.variables?.id === batch.id)
                        }
                        onClick={() => downloadMutation.mutate(batch)}
                      >
                        <DownloadIcon />
                        下载全部
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm">共 {total} 个批次</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((prev) => prev - 1)}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rangeEnd >= total}
            onClick={() => setPage((prev) => prev + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      <BatchDetailDialog
        batchId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(undefined);
        }}
      />
    </div>
  );
}
