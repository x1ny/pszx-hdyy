import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
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
import { api, unwrap } from "#/shared/lib/api";

/** 和 Better Auth 默认的 `minPasswordLength` 对齐。 */
const PASSWORD_MIN_LENGTH = 8;

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `新密码至少 ${PASSWORD_MIN_LENGTH} 位`)
      .max(128, "新密码最多 128 位"),
    confirm: z.string(),
  })
  .refine((value) => value.newPassword === value.confirm, {
    error: "两次输入的新密码不一致",
    path: ["confirm"],
  })
  // 新旧相同时服务端会照改不误（Better Auth 不管这个），但用户多半是没改成。
  .refine((value) => value.newPassword !== value.currentPassword, {
    error: "新密码不能和当前密码相同",
    path: ["newPassword"],
  });

/**
 * 改**自己**的密码。入口在右上角头像菜单。
 *
 * 接口调用直接写在这里，没有走 `system/user` 那个页面的 `-queries.ts`：跨路由
 * import 别人的 `-` 目录是 AGENTS.md 的铁律禁区。而放进 `features/auth/queries.ts`
 * 也不合适——那个文件是 Better Auth 客户端那条线（session），这里是我们自己的
 * 业务接口，两条路刻意分开。
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader
          title="修改密码"
          description="修改后当前登录状态保持有效，其它设备上的登录不受影响。"
        />
        {/* key 让每次打开都是干净的表单，不残留上次输入的密码。 */}
        {open && <ChangePasswordForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      unwrap(api.api.user.changePassword.$post({ json: input })),
    onSuccess: () => {
      toast.success("密码已修改");
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  const form = useForm({
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
    validators: {
      onChange: ChangePasswordSchema,
      onSubmit: ChangePasswordSchema,
    },
    onSubmit: ({ value }) =>
      mutation.mutate({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
      }),
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
        <form.Field name="currentPassword">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>当前密码</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="current-password"
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

        <form.Field name="newPassword">
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
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2Icon className="animate-spin" />}
          保存
        </Button>
      </DialogFooter>
    </form>
  );
}
