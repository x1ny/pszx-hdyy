import type { PermissionKey } from "@repo/server/permissions";
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
import { Textarea } from "#/shared/components/ui/textarea.tsx";
import type { Role, RoleFormValues } from "../-queries";
import { PermissionPicker } from "./permission-picker";

// 这份 schema 是 apps/server/src/modules/user/validation.ts 的镜像，**故意抄的**
// （不能 runtime import 服务端的校验代码，理由见 supplier-form-dialog.tsx 顶部）。
// 服务端始终是权威校验方，这份只负责让用户在点提交前就看到错误。
//
// 权限点这一项不在这里枚举：`PermissionKey` 是从服务端 `import type` 来的，
// 而复选框只可能产出清单里的值——再抄一份 enum 反而多一处会漂移的地方。
const RoleFormSchema = z.object({
  name: z.string().trim().min(1, "角色名称不能为空").max(50, "角色名称过长"),
  permissions: z.array(z.string()),
  remark: z.string().trim().max(200, "备注不超过 200 字"),
});

type RoleFormState = z.infer<typeof RoleFormSchema>;

/** 必填星号统一走这个组件上色，不要在标签文字里直接拼一个黑色的 `*`。 */
function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type RoleFormDialogProps = {
  open: boolean;
  /** 传了就是编辑，没传就是新增。 */
  role?: Role;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: RoleFormValues) => void;
};

export function RoleFormDialog({
  open,
  role,
  submitting,
  onOpenChange,
  onSubmit,
}: RoleFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader
          title={role ? "修改角色" : "新增角色"}
          description="勾选这个角色能进入的功能模块。能进即可操作，不再细分查看和编辑。"
        />
        {/* key 让切换记录时整个表单重新挂载（同 supplier）。 */}
        <RoleForm
          key={role?.id ?? "new"}
          role={role}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function RoleForm({
  role,
  submitting,
  onCancel,
  onSubmit,
}: {
  role?: Role;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: RoleFormValues) => void;
}) {
  const defaultValues: RoleFormState = {
    name: role?.name ?? "",
    permissions: role?.permissions ?? [],
    remark: role?.remark ?? "",
  };

  const form = useForm({
    defaultValues,
    // onChange 校验整个 schema；防「满屏飘红」的是渲染时的 isTouched 判断
    // （详见 supplier-form-dialog.tsx 里那段注释）。
    validators: { onChange: RoleFormSchema, onSubmit: RoleFormSchema },
    onSubmit: ({ value }) =>
      onSubmit({ ...value, permissions: value.permissions as PermissionKey[] }),
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
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>
                角色名称
                <RequiredMark />
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="例如：现场执行、财务只读"
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

        <form.Field name="permissions">
          {(field) => (
            <Field>
              <FieldLabel>功能权限</FieldLabel>
              {/* 刻意允许一个都不勾：`role` 表没有 status 列（见服务端 schema），
                  "清空权限"就是"停用这个角色"的表达方式。 */}
              <PermissionPicker
                value={field.state.value as PermissionKey[]}
                onChange={(next) => field.handleChange(next)}
              />
              <p className="text-muted-foreground text-xs">
                已选 {field.state.value.length} 项。不勾任何一项等于停用该角色。
              </p>
            </Field>
          )}
        </form.Field>

        <form.Field name="remark">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>备注</FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                rows={2}
                placeholder="这个角色给谁用、为什么这么配"
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
