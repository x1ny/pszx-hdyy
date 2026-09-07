import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { Textarea } from "#/shared/components/ui/textarea.tsx";
import type { AdminUser, UserFormValues } from "../-queries";
import { roleListQueryOptions } from "../-queries";
import {
  PASSWORD_MIN_LENGTH,
  USER_STATUS_LABELS,
  USER_STATUS_VALUES,
  USERNAME_PATTERN,
} from "../-utils";

// 这份 schema 是 apps/server/src/modules/user/validation.ts 的镜像，**故意抄的**
// （不能 runtime import 服务端代码，理由见 supplier-form-dialog.tsx 顶部那段）。
// 服务端**始终**是权威校验方，这份只负责让用户在点提交前就看到错误。
const UserFormSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "账号至少 3 位")
    .max(30, "账号最多 30 位")
    .regex(USERNAME_PATTERN, "账号只能包含字母、数字、下划线和点"),
  password: z.string(),
  name: z.string().trim().min(1, "姓名不能为空").max(64, "姓名过长"),
  email: z.union([z.literal(""), z.email("邮箱格式不正确")]),
  phone: z.string().trim().max(32, "手机号过长"),
  roleIds: z.array(z.number()),
  status: z.enum(USER_STATUS_VALUES),
  remark: z.string().trim().max(1000, "备注不超过 1000 字"),
});

type UserFormState = z.infer<typeof UserFormSchema>;

/**
 * 新增时密码必填，编辑时整个字段不存在（改密码走「重置密码」那个入口）。
 *
 * 用两份 schema 而不是在一份里写 `.optional()` + 手动判断：条件必填写在校验器
 * 之外的话，"编辑态密码为空"这条路径就没有任何东西盯着，改错了不会报错。
 */
const CreateUserFormSchema = UserFormSchema.extend({
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
    .max(128, "密码最多 128 位"),
});

/** 必填星号统一走这个组件上色，不要在标签文字里直接拼一个黑色的 `*`。 */
function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type UserFormDialogProps = {
  open: boolean;
  /** 传了就是编辑，没传就是新增。 */
  user?: AdminUser;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UserFormValues) => void;
};

export function UserFormDialog({
  open,
  user,
  submitting,
  onOpenChange,
  onSubmit,
}: UserFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader
          title={user ? "修改用户" : "新增用户"}
          description="带 * 的是必填项，保存后立即生效。"
        />
        {/* key 让切换记录时整个表单重新挂载（同 supplier）。 */}
        <UserForm
          key={user?.id ?? "new"}
          user={user}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function UserForm({
  user,
  submitting,
  onCancel,
  onSubmit,
}: {
  user?: AdminUser;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: UserFormValues) => void;
}) {
  const isEdit = !!user;
  const rolesQuery = useQuery(roleListQueryOptions());
  const roleItems = (rolesQuery.data ?? []).map((role) => ({
    value: role.id,
    label: role.name,
  }));

  const defaultValues: UserFormState = {
    username: user?.username ?? "",
    password: "",
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    roleIds: user?.roles.map((role) => role.id) ?? [],
    status: user?.status ?? "enabled",
    remark: user?.remark ?? "",
  };

  const schema = isEdit ? UserFormSchema : CreateUserFormSchema;

  const form = useForm({
    defaultValues,
    // onChange 校验的是整个 schema；真正防「满屏飘红」的是渲染时的 isTouched
    // 判断（详见 supplier-form-dialog.tsx 里那段注释）。
    validators: { onChange: schema, onSubmit: schema },
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
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="username">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  登录账号
                  {!isEdit && <RequiredMark />}
                </FieldLabel>
                {/* 编辑时禁用：账号名是登录标识，改了等于换一个人。服务端的
                    /update 接口压根不收这个字段，这里禁用只是把那条约束显式化。 */}
                <Input
                  id={field.name}
                  name={field.name}
                  disabled={isEdit}
                  placeholder="字母、数字、下划线或点，3-30 位"
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
                  placeholder="请输入真实姓名"
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

          {/* 密码只在新增时出现。编辑态改密码走列表里的「重置密码」，
              两条路分开，避免一次误提交把别人的密码冲掉。 */}
          {!isEdit && (
            <form.Field name="password">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>
                    初始密码
                    <RequiredMark />
                  </FieldLabel>
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
          )}

          <form.Field name="phone">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>手机号</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="选填"
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

          <form.Field name="email">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>邮箱</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  placeholder="选填"
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

          <form.Field name="roleIds">
            {(field) => (
              <Field>
                <FieldLabel>角色</FieldLabel>
                {/* 多选：一个人可以同时是多个角色，权限取并集
                    （见 modules/user/schema.ts 的 userRole）。
                    **刻意不设成必填**：本次只预置一条"超级管理员"，必填等于逼着
                    每个新账号都挂最高权限；没有角色 = 将来什么都不能做，才是新
                    账号该有的起点。 */}
                <Select
                  multiple
                  items={roleItems}
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value as number[]);
                    // Select 关闭时不触发原生 blur，手动标记（同 supplier）。
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger className="w-full" onBlur={field.handleBlur}>
                    <SelectValue>
                      {(value: number[]) =>
                        value?.length ? (
                          roleItems
                            .filter((item) => value.includes(item.value))
                            .map((item) => item.label)
                            .join("、")
                        ) : (
                          <span className="text-muted-foreground">
                            未分配角色
                          </span>
                        )
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {roleItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="status">
            {(field) => (
              <Field>
                <FieldLabel>状态</FieldLabel>
                <Select
                  items={USER_STATUS_VALUES.map((value) => ({
                    value,
                    label: USER_STATUS_LABELS[value],
                  }))}
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as UserFormState["status"])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {USER_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="remark">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>备注</FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                rows={3}
                placeholder="记录这个账号的用途、所属团队等说明"
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
