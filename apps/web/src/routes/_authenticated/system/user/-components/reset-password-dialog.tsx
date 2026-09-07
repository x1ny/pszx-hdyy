import { useForm } from "@tanstack/react-form";
import { Loader2Icon } from "lucide-react";
import { z } from "zod";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx";
import {
  Field,
  FieldError,
  FieldLabel,
} from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import type { AdminUser } from "../-queries";
import { PASSWORD_MIN_LENGTH } from "../-utils";

const ResetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
      .max(128, "密码最多 128 位"),
    confirm: z.string(),
  })
  // 二次确认只在前端存在，服务端不收这个字段——它防的是手滑打错，不是安全问题。
  // 管理员设的密码要口头/书面转告本人，打错一个字符对方就登不上，而且没人知道
  // 错在哪。
  .refine((value) => value.password === value.confirm, {
    error: "两次输入的密码不一致",
    path: ["confirm"],
  });

type ResetPasswordDialogProps = {
  /** 传了就打开，没传就关着。 */
  user?: AdminUser;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => void;
};

export function ResetPasswordDialog({
  user,
  submitting,
  onOpenChange,
  onSubmit,
}: ResetPasswordDialogProps) {
  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader
          title="重置密码"
          description={
            user
              ? `为「${user.name}（${user.username ?? "无账号名"}）」设置一个新密码，保存后立即生效。`
              : ""
          }
        />
        {/* key 让换一个用户时表单重新挂载，不残留上一次输入的密码。 */}
        <ResetPasswordForm
          key={user?.id ?? "none"}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordForm({
  submitting,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const form = useForm({
    defaultValues: { password: "", confirm: "" },
    validators: {
      onChange: ResetPasswordSchema,
      onSubmit: ResetPasswordSchema,
    },
    onSubmit: ({ value }) => onSubmit(value.password),
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
        <form.Field name="password">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>新密码</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="new-password"
                placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`}
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

        <form.Field name="confirm">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>确认新密码</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="new-password"
                placeholder="再输入一次"
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
