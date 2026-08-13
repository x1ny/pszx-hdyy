import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/shared/components/ui/sheet.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { buildInvitationDocument } from "../../-shared/document.ts";
import { exportInvitationDocx } from "../../-shared/export-docx.ts";
import { InvitationPreview } from "../../-shared/invitation-preview.tsx";
import { ISSUER_LABELS } from "../../-shared/issuer-visual.ts";
import { maskMobile } from "../../generate/-utils.ts";
import { formatDateTime } from "../-utils";
import type { InvitationBatch, InvitationBatchItem } from "../-queries";

const RESPONSE_STATUS_LABELS: Record<InvitationBatchItem["responseStatus"], string> = {
  pending: "待回复",
  accepted: "已参加",
  declined: "已拒绝",
};

type BatchDetailSheetProps = {
  batch?: InvitationBatch;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BatchDetailSheet({ batch, loading, onOpenChange }: BatchDetailSheetProps) {
  const [previewItem, setPreviewItem] = useState<InvitationBatchItem>();
  const [downloadingId, setDownloadingId] = useState<number>();

  const handleDownload = async (item: InvitationBatchItem) => {
    if (!batch) return;
    setDownloadingId(item.id);
    try {
      const doc = buildInvitationDocument(batch, {
        recipientName: item.recipientName,
        issueDate: batch.issueDate,
      });
      await exportInvitationDocx(doc, item.recipientName);
      toast.success(`已下载 ${item.recipientName} 的邀请函`);
    } catch {
      toast.error("下载失败，请重试");
    } finally {
      setDownloadingId(undefined);
    }
  };

  return (
    <>
      <Sheet open={!!batch || !!loading} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 sm:max-w-2xl">
          {loading || !batch ? (
            <div className="p-6 text-center text-muted-foreground">加载中...</div>
          ) : (
            <>
              <SheetHeader>
                <SheetTitle>{batch.batchNo}</SheetTitle>
                <SheetDescription>
                  {batch.templateName} · {ISSUER_LABELS[batch.issuer]}
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-6">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                  <dt className="text-muted-foreground">生成数量</dt>
                  <dd className="text-right">{batch.itemCount}</dd>
                  <dt className="text-muted-foreground">发函日期</dt>
                  <dd className="text-right">{batch.issueDate}</dd>
                  <dt className="text-muted-foreground">落款</dt>
                  <dd className="whitespace-pre-line text-right">{batch.signOff}</dd>
                  <dt className="text-muted-foreground">生成人</dt>
                  <dd className="text-right">{batch.createdByName || "-"}</dd>
                  <dt className="text-muted-foreground">生成时间</dt>
                  <dd className="text-right">{formatDateTime(batch.createdAt)}</dd>
                </dl>

                <Table>
                  <TableHeader className="bg-muted/60">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>姓名</TableHead>
                      <TableHead>职务</TableHead>
                      <TableHead>手机号</TableHead>
                      <TableHead>回复状态</TableHead>
                      <TableHead className="text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batch.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.recipientName}</TableCell>
                        <TableCell>{item.companyPosition || "-"}</TableCell>
                        <TableCell>{maskMobile(item.mobile)}</TableCell>
                        <TableCell>{RESPONSE_STATUS_LABELS[item.responseStatus]}</TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-primary hover:text-primary"
                              onClick={() => setPreviewItem(item)}
                            >
                              预览
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-primary hover:text-primary"
                              disabled={downloadingId === item.id}
                              onClick={() => handleDownload(item)}
                            >
                              下载 Word
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(undefined)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>邀请函预览</DialogTitle>
          </DialogHeader>
          {batch && previewItem ? (
            <InvitationPreview
              doc={buildInvitationDocument(batch, {
                recipientName: previewItem.recipientName,
                issueDate: batch.issueDate,
              })}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
