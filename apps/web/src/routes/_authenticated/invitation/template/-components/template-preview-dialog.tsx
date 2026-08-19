import { DocxPreview } from "#/features/invitation/docx-preview";
import { previewInvitationTemplate } from "#/features/invitation/queries";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";

/**
 * 预览的是**服务端用样例数据真实渲染出来的那份 .docx**，不是前端另画的版面。
 * 自定义变量填成「【变量名】」，一眼能看出每个变量落在版面的哪个位置。
 */
export function TemplatePreviewDialog({
  open,
  templateFileId,
  onOpenChange,
}: {
  open: boolean;
  templateFileId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>模板预览</DialogTitle>
          <DialogDescription>
            用样例数据渲染的效果。页面内预览受浏览器排版能力限制，印章位置、红头
            线条可能与 Word 里略有出入，最终以下载的文件为准。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {templateFileId ? (
            <DocxPreview
              // fileId 进 key：换了文件必须重新拉，不能命中上一份的缓存。
              queryKey={["invitationTemplatePreview", templateFileId]}
              enabled={open}
              load={() => previewInvitationTemplate({ templateFileId })}
            />
          ) : (
            <p className="py-8 text-center text-muted-foreground text-sm">
              请先上传模板文件
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
