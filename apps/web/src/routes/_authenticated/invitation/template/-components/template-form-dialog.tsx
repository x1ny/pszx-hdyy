import { useForm } from "@tanstack/react-form";
import { Loader2Icon } from "lucide-react";
import { z } from "zod";
import { RichTextEditor } from "#/shared/components/rich-text-editor.tsx";
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
import {
  Field,
  FieldError,
  FieldLabel,
} from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import type {
  InvitationTemplate,
  InvitationTemplateFormValues,
} from "../-queries";
import {
  ISSUER_LABELS,
  ISSUER_VALUES,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUS_VALUES,
} from "../-utils";

// apps/server/src/modules/invitation/validation.ts 的 InvitationTemplateFields
// 镜像，理由同 supplier-form-dialog.tsx——服务端始终是权威校验方。
const richTextRequired = (label: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) => value.replace(/<[^>]+>/g, "").trim().length > 0,
      `${label}不能为空`,
    );

const TemplateFormSchema = z.object({
  name: z.string().trim().min(1, "模板名称不能为空").max(255, "模板名称过长"),
  issuer: z.enum(ISSUER_VALUES),
  applicableDesc: z.string().trim().max(255, "适用说明过长"),
  status: z.enum(TEMPLATE_STATUS_VALUES),
  bodyContent: richTextRequired("正文内容"),
  annexTitle: z.string().trim().max(255, "附则标题过长"),
  annexContent: z.string().trim(),
  contactPerson: z
    .string()
    .trim()
    .min(1, "联系人不能为空")
    .max(64, "联系人过长"),
  contactPhone: z
    .string()
    .trim()
    .regex(/^[\d\-+()（）\s]{5,20}$/, "请输入正确的联系电话"),
  signOff: z.string().trim().min(1, "落款不能为空").max(128, "落款过长"),
});

type TemplateFormState = z.infer<typeof TemplateFormSchema>;

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type TemplateFormDialogProps = {
  open: boolean;
  template?: InvitationTemplate;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: InvitationTemplateFormValues) => void;
};

export function TemplateFormDialog({
  open,
  template,
  submitting,
  onOpenChange,
  onSubmit,
}: TemplateFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template ? "编辑模板" : "新增模板"}</DialogTitle>
          <DialogDescription>
            带 * 的是必填项，保存后立即生效。
          </DialogDescription>
        </DialogHeader>
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
  const defaultValues: TemplateFormState = {
    name: template?.name ?? "",
    issuer: template?.issuer ?? "plain",
    applicableDesc: template?.applicableDesc ?? "",
    status: template?.status ?? "enabled",
    bodyContent: template?.bodyContent ?? "",
    annexTitle: template?.annexTitle ?? "",
    annexContent: template?.annexContent ?? "",
    contactPerson: template?.contactPerson ?? "",
    contactPhone: template?.contactPhone ?? "",
    signOff: template?.signOff ?? "",
  };

  const form = useForm({
    defaultValues,
    validators: { onChange: TemplateFormSchema, onSubmit: TemplateFormSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <form.Field name="name">
            {(field) => (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={field.name}>
                  模板名称
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  placeholder="请输入模板名称"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={
                    field.state.meta.isTouched &&
                    field.state.meta.errors.length > 0
                  }
                />
                <FieldError
                  errors={
                    field.state.meta.isTouched ? field.state.meta.errors : []
                  }
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="issuer">
            {(field) => (
              <Field>
                <FieldLabel>
                  发函主体
                  <RequiredMark />
                </FieldLabel>
                <Select
                  items={ISSUER_LABELS}
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as TemplateFormState["issuer"])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUER_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ISSUER_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="applicableDesc">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>适用说明</FieldLabel>
                <Input
                  id={field.name}
                  placeholder="写一些关于模板的备注/说明内容"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="status">
            {(field) => (
              <Field>
                <FieldLabel>
                  状态
                  <RequiredMark />
                </FieldLabel>
                <Select
                  items={TEMPLATE_STATUS_LABELS}
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as TemplateFormState["status"])
                  }
                >
                  <SelectTrigger className="w-full">
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
        </div>

        <form.Field name="bodyContent">
          {(field) => (
            <Field>
              <FieldLabel>
                正文内容
                <RequiredMark />
              </FieldLabel>
              <RichTextEditor
                value={field.state.value}
                placeholder="请输入正文内容"
                onChange={(html) => {
                  field.handleChange(html);
                  field.handleBlur();
                }}
              />
              <FieldError
                errors={
                  field.state.meta.isTouched ? field.state.meta.errors : []
                }
              />
            </Field>
          )}
        </form.Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <form.Field name="contactPerson">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  联系人
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  placeholder="请输入联系人"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={
                    field.state.meta.isTouched &&
                    field.state.meta.errors.length > 0
                  }
                />
                <FieldError
                  errors={
                    field.state.meta.isTouched ? field.state.meta.errors : []
                  }
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="contactPhone">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  联系电话
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  placeholder="请输入联系电话"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={
                    field.state.meta.isTouched &&
                    field.state.meta.errors.length > 0
                  }
                />
                <FieldError
                  errors={
                    field.state.meta.isTouched ? field.state.meta.errors : []
                  }
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="signOff">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  落款
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  placeholder="请输入落款名称"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={
                    field.state.meta.isTouched &&
                    field.state.meta.errors.length > 0
                  }
                />
                <FieldError
                  errors={
                    field.state.meta.isTouched ? field.state.meta.errors : []
                  }
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="annexTitle">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>附则标题</FieldLabel>
              <Input
                id={field.name}
                placeholder="请输入附则标题（可选）"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="annexContent">
          {(field) => (
            <Field>
              <FieldLabel>附则内容</FieldLabel>
              <RichTextEditor
                value={field.state.value}
                placeholder="请输入附则内容（可选）"
                onChange={(html) => field.handleChange(html)}
              />
            </Field>
          )}
        </form.Field>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2Icon className="animate-spin" />}
          保存
        </Button>
      </DialogFooter>
    </form>
  );
}
