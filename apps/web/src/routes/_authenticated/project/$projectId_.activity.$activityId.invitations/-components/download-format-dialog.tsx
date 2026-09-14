import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { InvitationDownloadFormat } from "#/features/invitation/queries";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import { ExportFormatSelect } from "./export-format-select";

export function DownloadFormatDialog({
  open,
  pending = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (format: InvitationDownloadFormat) => void;
}) {
  const [format, setFormat] = useState<InvitationDownloadFormat>("docx");

  useEffect(() => {
    if (open) setFormat("docx");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>选择导出格式</DialogTitle>
          <DialogDescription>请选择本次邀请函的下载格式。</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <ExportFormatSelect
            value={format}
            onValueChange={setFormat}
            disabled={pending}
          />
          {format === "pdf" ? (
            <p className="text-muted-foreground text-sm">
              PDF 转换需要一些时间，请耐心等待下载完成。
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => onConfirm(format)}
          >
            <DownloadIcon />
            开始下载
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
