import { Loader2Icon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import { buildInvitationDocument } from "../../-shared/document.ts";
import { InvitationPreview } from "../../-shared/invitation-preview.tsx";
import type { InvitationTemplate } from "../-queries";

type TemplatePreviewDialogProps = {
  open: boolean;
  loading?: boolean;
  template?: InvitationTemplate;
  onOpenChange: (open: boolean) => void;
};

/**
 * 模板本身没有存日期（旧版的"默认发函日期"是个必然过期的字段，已经删掉），
 * 预览用当天日期，只是给"长什么样"一个示例，真正的发函日期在生成邀请函时填。
 */
export function TemplatePreviewDialog({
  open,
  loading,
  template,
  onOpenChange,
}: TemplatePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>邀请函预览</DialogTitle>
        </DialogHeader>
        {loading || !template ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin" />
          </div>
        ) : (
          <InvitationPreview doc={buildInvitationDocument(template)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
