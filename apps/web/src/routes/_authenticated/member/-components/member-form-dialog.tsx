import { useForm } from "@tanstack/react-form";
import { LoaderCircleIcon } from "lucide-react";
import { z } from "zod";
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
import { Textarea } from "#/shared/components/ui/textarea.tsx";
import type { Member, MemberFormValues } from "../-queries";
import {
  getIdNumberValidationRule,
  MEMBER_GENDER_VALUES,
  MEMBER_ID_TYPE_LABELS,
  MEMBER_ID_TYPE_VALUES,
  MEMBER_STATUS_LABELS,
  MEMBER_STATUS_VALUES,
} from "../-utils";

const MemberFormSchema = z
  .object({
    name: z.string().trim().min(1, "姓名不能为空").max(64, "姓名过长"),
    status: z.enum(MEMBER_STATUS_VALUES),
    gender: z.enum(MEMBER_GENDER_VALUES).or(z.literal("")).optional(),
    countryRegion: z.string().trim().max(64, "国别/地区过长").optional(),
    nativePlace: z.string().trim().max(128, "籍贯过长").optional(),
    companyPosition: z
      .string()
      .trim()
      .max(255, "企业（社会）职务过长")
      .optional(),
    idType: z.enum(MEMBER_ID_TYPE_VALUES).or(z.literal("")).optional(),
    idNumber: z.string().trim().max(64, "证件号码过长").optional(),
    mobile: z
      .string()
      .trim()
      .max(20, "手机号过长")
      .refine(
        (value) => !value || /^1\d{10}$/.test(value),
        "请输入正确的手机号",
      )
      .optional(),
    phone: z
      .string()
      .trim()
      .max(32, "电话过长")
      .refine(
        (value) => !value || /^0\d{2,3}-?\d{7,8}$/.test(value),
        "请输入正确的电话号码，如 010-12345678",
      )
      .optional(),
    email: z
      .string()
      .trim()
      .max(128, "邮箱过长")
      .refine(
        (value) => !value || z.email().safeParse(value).success,
        "请输入正确的邮箱",
      )
      .optional(),
    language: z.string().trim().max(32, "语种过长").optional(),
    remark: z.string().trim().max(2000, "备注过长").optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.idNumber) return;

    const rule = getIdNumberValidationRule(value.idType);
    if (!rule.pattern.test(value.idNumber)) {
      ctx.addIssue({
        code: "custom",
        path: ["idNumber"],
        message: rule.message,
      });
    }
  });

type MemberFormState = z.infer<typeof MemberFormSchema>;

type MemberFormDialogProps = {
  open: boolean;
  member?: Member;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: MemberFormValues) => void;
};

export function MemberFormDialog({
  open,
  member,
  submitting,
  onOpenChange,
  onSubmit,
}: MemberFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{member ? "修改人员" : "新增人员"}</DialogTitle>
          <DialogDescription>
            带 * 的是必填项，保存后立即生效。
          </DialogDescription>
        </DialogHeader>
        <MemberForm
          key={member?.id ?? "new"}
          member={member}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function MemberForm({
  member,
  submitting,
  onCancel,
  onSubmit,
}: {
  member?: Member;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: MemberFormValues) => void;
}) {
  const defaultValues: MemberFormState = {
    name: member?.name ?? "",
    status: member?.status ?? "enabled",
    gender: member?.gender ?? "",
    countryRegion: member?.countryRegion ?? "",
    nativePlace: member?.nativePlace ?? "",
    companyPosition: member?.companyPosition ?? "",
    idType: member?.idType ?? "",
    idNumber: member?.idNumber ?? "",
    mobile: member?.mobile ?? "",
    phone: member?.phone ?? "",
    email: member?.email ?? "",
    language: member?.language ?? "",
    remark: member?.remark ?? "",
  };

  const form = useForm({
    defaultValues,
    validators: {
      onChange: MemberFormSchema,
      onSubmit: MemberFormSchema,
    },
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
      <DialogBody className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  姓名
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="请输入姓名"
                  value={field.state.value ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={hasError(field)}
                />
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="gender">
            {(field) => (
              <Field>
                <FieldLabel>性别</FieldLabel>
                <Select
                  items={{ 男: "男", 女: "女" }}
                  value={field.state.value || null}
                  onValueChange={(value) => {
                    field.handleChange(value ?? "");
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-invalid={hasError(field)}
                  >
                    <SelectValue placeholder="请选择性别" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>不填写</SelectItem>
                    {MEMBER_GENDER_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="status">
            {(field) => (
              <Field>
                <FieldLabel>启用状态</FieldLabel>
                <Select
                  items={MEMBER_STATUS_LABELS}
                  value={field.state.value}
                  onValueChange={(value) => {
                    if (value)
                      field.handleChange(value as MemberFormState["status"]);
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMBER_STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {MEMBER_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="countryRegion">
            {(field) => (
              <TextField
                field={field}
                label="国别 / 地区"
                placeholder="请输入国别 / 地区"
              />
            )}
          </form.Field>

          <form.Field name="nativePlace">
            {(field) => (
              <TextField field={field} label="籍贯" placeholder="请输入籍贯" />
            )}
          </form.Field>

          <form.Field name="companyPosition">
            {(field) => (
              <TextField
                field={field}
                label="企业（社会）职务"
                placeholder="请输入企业（社会）职务"
                className="sm:col-span-2"
              />
            )}
          </form.Field>

          <form.Field name="idType">
            {(field) => (
              <Field>
                <FieldLabel>证件类型</FieldLabel>
                <Select
                  items={MEMBER_ID_TYPE_LABELS}
                  value={field.state.value || null}
                  onValueChange={(value) => {
                    field.handleChange(value ?? "");
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-invalid={hasError(field)}
                  >
                    <SelectValue placeholder="请选择证件类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>不填写</SelectItem>
                    {MEMBER_ID_TYPE_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {MEMBER_ID_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="idNumber">
            {(field) => (
              <TextField
                field={field}
                label="证件号码"
                placeholder="请输入证件号码"
              />
            )}
          </form.Field>

          <form.Field name="mobile">
            {(field) => (
              <TextField
                field={field}
                label="手机号"
                placeholder="请输入手机号"
              />
            )}
          </form.Field>

          <form.Field name="phone">
            {(field) => (
              <TextField
                field={field}
                label="电话"
                placeholder="请输入电话，如 010-12345678"
              />
            )}
          </form.Field>

          <form.Field name="email">
            {(field) => (
              <TextField field={field} label="邮箱" placeholder="请输入邮箱" />
            )}
          </form.Field>

          <form.Field name="language">
            {(field) => (
              <TextField field={field} label="语种" placeholder="请输入语种" />
            )}
          </form.Field>
        </div>

        <form.Field name="remark">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>备注 / 说明</FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                rows={4}
                placeholder="请输入备注 / 说明"
                value={field.state.value ?? ""}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={hasError(field)}
              />
              <FieldError errors={fieldErrors(field)} />
            </Field>
          )}
        </form.Field>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <LoaderCircleIcon className="animate-spin" />}
          保存
        </Button>
      </DialogFooter>
    </form>
  );
}

function TextField({
  field,
  label,
  placeholder,
  className,
}: {
  field: {
    name: string;
    state: {
      value: string | undefined;
      meta: {
        isTouched: boolean;
        errors: Array<{ message?: string } | undefined>;
      };
    };
    handleBlur: () => void;
    handleChange: (value: string) => void;
  };
  label: string;
  placeholder: string;
  className?: string;
}) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        placeholder={placeholder}
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={hasError(field)}
      />
      <FieldError errors={fieldErrors(field)} />
    </Field>
  );
}

function hasError(field: {
  state: {
    meta: {
      isTouched: boolean;
      errors: Array<{ message?: string } | undefined>;
    };
  };
}) {
  return field.state.meta.isTouched && field.state.meta.errors.length > 0;
}

function fieldErrors(field: {
  state: {
    meta: {
      isTouched: boolean;
      errors: Array<{ message?: string } | undefined>;
    };
  };
}) {
  return field.state.meta.isTouched ? field.state.meta.errors : [];
}

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}
