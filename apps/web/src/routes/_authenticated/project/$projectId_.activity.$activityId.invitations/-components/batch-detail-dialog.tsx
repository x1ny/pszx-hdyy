import { useMutation, useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDateTime, maskMobile } from "#/features/invitation/labels";
import {
  downloadInvitationBatch,
  downloadInvitationRecord,
  getInvitationBatch,
  invitationBatchKeys,
  saveBlob,
} from "#/features/invitation/queries";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";

export function BatchDetailDialog({
  batchId,
  onOpenChange,
}: {
  batchId?: number;
  onOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const detailQuery = useQuery({
    queryKey: invitationBatchKeys.detail(batchId ?? 0),
    queryFn: () => getInvitationBatch(batchId as number),
    enabled: batchId !== undefined,
  });

  const batch = detailQuery.data;
  const records = batch?.records ?? [];

  useEffect(() => {
    setSelected(new Set());
  }, [batchId]);

  const singleMutation = useMutation({
    mutationFn: (recordId: number) => downloadInvitationRecord(recordId),
    onSuccess: ({ blob, fileName }) => saveBlob(blob, fileName),
    onError: (error) => toast.error(error.message),
  });

  const zipMutation = useMutation({
    mutationFn: () =>
      downloadInvitationBatch(
        batchId as number,
        selected.size > 0 ? [...selected] : undefined,
      ),
    onSuccess: ({ blob, fileName }) => {
      saveBlob(blob, fileName);
      toast.success("已开始下载");
    },
    onError: (error) => toast.error(error.message),
  });

  const allSelected =
    records.length > 0 && records.every((row) => selected.has(row.memberId));

  const customVariables = Object.entries(batch?.variables ?? {});

  return (
    <Dialog open={batchId !== undefined} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>邀请人员名单</DialogTitle>
          <DialogDescription>
            {batch
              ? `${batch.batchNo} · ${batch.templateName} · 发函日期 ${batch.issueDate}`
              : "加载中…"}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {customVariables.length > 0 ? (
            <div className="mb-3 space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">本批次变量取值</div>
              {/* 快照，不是当前模板上的值——模板后来改了也不影响已经生成的这一批。 */}
              {customVariables.map(([name, value]) => (
                <div key={name} className="text-muted-foreground">
                  <code className="rounded bg-background px-1 py-0.5 text-xs">
                    {`{{${name}}}`}
                  </code>{" "}
                  {value || "（空）"}
                </div>
              ))}
            </div>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked === true
                            ? new Set(records.map((row) => row.memberId))
                            : new Set(),
                        )
                      }
                    />
                  </TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>单位职务</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>生成时间</TableHead>
                  <TableHead className="text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailQuery.isPending ? (
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
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-muted-foreground text-sm"
                    >
                      这一批没有邀请函记录。
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(row.memberId)}
                          onCheckedChange={(checked) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.add(row.memberId);
                              else next.delete(row.memberId);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.recipientName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.companyPosition || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {maskMobile(row.mobile)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary"
                          disabled={
                            singleMutation.isPending &&
                            singleMutation.variables === row.id
                          }
                          onClick={() => singleMutation.mutate(row.id)}
                        >
                          <DownloadIcon />
                          下载
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button
            disabled={records.length === 0 || zipMutation.isPending}
            onClick={() => zipMutation.mutate()}
          >
            <DownloadIcon />
            {selected.size > 0 ? `下载选中 ${selected.size} 份` : "下载全部"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
