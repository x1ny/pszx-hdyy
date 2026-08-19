import { useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import sampleTemplateUrl from "#/assets/泉州市纺织服装商会模板.docx?url";
import { fileUrl, uploadFile } from "#/features/file/queries";
import {
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUS_VALUES,
} from "#/features/invitation/labels";
import {
  type InvitationTemplate,
  type InvitationTemplateFormValues,
  type InvitationTemplateVariable,
  inspectInvitationTemplate,
} from "#/features/invitation/queries";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import { Field, FieldError, FieldLabel } from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { TemplatePreviewDialog } from "./template-preview-dialog";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// 校验走 zod schema 而不是逐字段写回调，同 supplier 表单——一处定义，onChange
// 和 onSubmit 共用，不会出现「边打字不报错、提交才报错」的割裂。
const TemplateFormSchema = z.object({
  name: z.string().trim().min(1, "模板名称不能为空").max(255, "模板名称过长"),
  applicableDesc: z.string().trim().max(255, "适用说明过长"),
  status: z.enum(["enabled", "disabled"]),
  templateFileId: z.string().min(1, "请先上传模板文件"),
});

type Props = {
  open: boolean;
  template?: InvitationTemplate;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: InvitationTemplateFormValues) => void;
};

/**
 * 模板表单。
 *
 * **它不再编辑任何邀请函内容。** 正文、落款、联系人全部在 .docx 文件里——版式
 * 和内容是一体的，拆开在两个地方维护必然对不上。这里只剩三个属于「模板这条
 * 记录」的字段，加上那个决定一切的文件。
 *
 * 变量取值也不在这里填：按业务决策，自定义变量一律在生成页填（同一个模板在
 * 不同批次可以填不同的联系人），所以这里只把变量**清单**摊开给用户看。
 */
export function TemplateFormDialog({
  open,
  template,
  submitting,
  onOpenChange,
  onSubmit,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? "编辑模板" : "新增模板"}</DialogTitle>
        </DialogHeader>

        {/* key 让切换记录时整个表单重新挂载，初值直接由 props 推出。
            曾经用 useEffect + form.reset 回填，实测编辑弹窗整个是空的——名称、
            状态、已传文件全没回填，连带「预览样例」永远禁用、保存也会因为
            templateFileId 为空而失败。同 supplier 表单的做法。 */}
        <TemplateForm
          key={template?.id ?? "new"}
          template={template}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({
  template,
  submitting,
  onCancel,
  onSubmit,
}: {
  template?: InvitationTemplate;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: InvitationTemplateFormValues) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [variables, setVariables] = useState<InvitationTemplateVariable[]>(
    template?.variables ?? [],
  );
  const [fileName, setFileName] = useState(template?.templateFileName);

  const form = useForm({
    defaultValues: {
      name: template?.name ?? "",
      applicableDesc: template?.applicableDesc ?? "",
      status: template?.status ?? "enabled",
      templateFileId: template?.templateFileId ?? "",
    },
    validators: {
      onChange: TemplateFormSchema,
      onSubmit: TemplateFormSchema,
    },
    onSubmit: ({ value }) => onSubmit(value),
  });

  const templateFileId = useStore(form.store, (s) => s.values.templateFileId);

  /**
   * 上传和解析是一个动作的两半，串在一个 mutation 里。
   *
   * 分成两步会出现「文件传上去了但没解析成功」的中间态——那个 file_asset 行
   * 已经存在，用户却看不到任何变量，也不知道该重传还是该保存。
   */
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const uploaded = await uploadFile(file);
      const inspected = await inspectInvitationTemplate(uploaded.id);
      return { uploaded, inspected };
    },
    onSuccess: ({ uploaded, inspected }) => {
      form.setFieldValue("templateFileId", uploaded.id);
      setVariables(inspected.variables);
      setFileName(uploaded.originalName);
      toast.success(`解析成功，共 ${inspected.variables.length} 个变量`);
    },
    onError: (error) => toast.error(error.message),
  });

  const systemVariables = variables.filter((item) => item.kind === "system");
  const customVariables = variables.filter((item) => item.kind === "custom");

  return (
    <>
      <DialogBody>
        <form
          id="template-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field name="name">
            {(field) => (
              <Field
                data-invalid={
                  field.state.meta.isTouched && field.state.meta.errors.length > 0
                }
              >
                <FieldLabel htmlFor={field.name}>模板名称</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  placeholder="如：泉州市纺织服装商会 · 正式邀请函"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldError
                  errors={
                    field.state.meta.isTouched ? field.state.meta.errors : []
                  }
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="status">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>状态</FieldLabel>
                <Select
                  items={TEMPLATE_STATUS_VALUES.map((value) => ({
                    value,
                    label: TEMPLATE_STATUS_LABELS[value],
                  }))}
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as typeof field.state.value)
                  }
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {TEMPLATE_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="applicableDesc">
            {(field) => (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={field.name}>适用说明</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  placeholder="选填，如：适用于市级以上单位受邀嘉宾"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </form>

        <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium text-sm">
              <FileTextIcon className="size-4 text-muted-foreground" />
              模板文件（.docx）
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadMutation.isPending ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <UploadIcon />
                )}
                {templateFileId ? "重新上传" : "选择文件"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!templateFileId}
                onClick={() => setPreviewOpen(true)}
              >
                预览样例
              </Button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // 清空 value，否则重选同一个文件不会触发 change。
              event.target.value = "";
              if (!file) return;

              // 旧版 .doc 是 OLE 复合文档，不是 zip，解析器读不了。在这里拦住
              // 比让用户等一个「无法解压」的服务端报错要清楚。
              if (!file.name.toLowerCase().endsWith(".docx")) {
                toast.error(
                  "只支持 .docx。旧版 .doc 请先用 Word 另存为 .docx 再上传",
                );
                return;
              }
              if (file.type && file.type !== DOCX_MIME) {
                toast.warning("文件类型看起来不是 Word 文档，正在尝试解析");
              }
              uploadMutation.mutate(file);
            }}
          />

          {templateFileId ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <CheckCircle2Icon className="size-4 shrink-0 text-success" />
              <span className="break-all">{fileName ?? "已上传的模板文件"}</span>
              {/* 直链而不是走 mutation：浏览器原生下载，不用把 660KB 的文件
                  先读进内存再造 blob URL。 */}
              <a
                href={fileUrl(templateFileId, true)}
                download
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <DownloadIcon className="size-3.5" />
                下载
              </a>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              版式、正文、红头、印章全部来自这个文件。要在文件里用变量，写成{" "}
              <code className="rounded bg-muted px-1 py-0.5">{"{{变量名}}"}</code>
              。
            </p>
          )}

          {variables.length > 0 ? (
            <div className="space-y-2 border-t pt-3">
              <VariableGroup
                title="系统变量"
                hint="生成时自动填充，不需要人工输入"
                names={systemVariables.map((item) => item.name)}
                tone="system"
              />
              <VariableGroup
                title="生成时填写"
                hint="每次生成邀请函时在生成页填写"
                names={customVariables.map((item) => item.name)}
                tone="custom"
              />
            </div>
          ) : templateFileId ? (
            <p className="border-t pt-3 text-muted-foreground text-sm">
              这个文件里没有任何 <code>{"{{变量名}}"}</code>{" "}
              占位符——所有内容都是固定的，生成出来的每一份都完全一样。
            </p>
          ) : null}

          {/* 示例就是业务方那份真实模板本身，不另造一份：排版规格（固定 28 磅、
              首行缩进 2 字符、红头双线）照抄不出来，拿原件改才不会失真。

              布局照抄上面那行「标题在左、按钮在右」：链接是 inline-flex（带
              图标），夹在一句话中间会和周围文字基线错位，也挤在一起看不出边界。 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-muted-foreground text-xs">
              没有现成的模板文件？在示例上改文字，把要替换的地方写成{" "}
              {"{{变量名}}"} 再传回来。
            </span>
            <a
              href={sampleTemplateUrl}
              download="泉州市纺织服装商会模板.docx"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-primary text-xs hover:underline"
            >
              <DownloadIcon className="size-3.5" />
              下载示例模板
            </a>
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="submit"
          form="template-form"
          disabled={submitting || uploadMutation.isPending}
        >
          {submitting ? <Loader2Icon className="animate-spin" /> : null}
          保存
        </Button>
      </DialogFooter>

      <TemplatePreviewDialog
        open={previewOpen}
        templateFileId={templateFileId || undefined}
        onOpenChange={setPreviewOpen}
      />
    </>
  );
}

function VariableGroup({
  title,
  hint,
  names,
  tone,
}: {
  title: string;
  hint: string;
  names: string[];
  tone: "system" | "custom";
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium text-sm">{title}</span>
      {names.length === 0 ? (
        <span className="text-muted-foreground text-xs">无</span>
      ) : (
        <>
          {names.map((name) => (
            <code
              key={name}
              className={
                tone === "system"
                  ? "rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-success-foreground text-xs"
                  : "rounded border bg-background px-1.5 py-0.5 text-xs"
              }
            >
              {`{{${name}}}`}
            </code>
          ))}
          <span className="text-muted-foreground text-xs">{hint}</span>
        </>
      )}
    </div>
  );
}
