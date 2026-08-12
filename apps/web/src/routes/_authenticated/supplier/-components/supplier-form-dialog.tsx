import { useForm } from "@tanstack/react-form";
import { Loader2Icon } from "lucide-react";
import { z } from "zod";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
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
import type {
  ServiceCategory,
  Supplier,
  SupplierFormValues,
} from "../-queries";
import {
  SERVICE_CATEGORY_LABELS,
  SERVICE_CATEGORY_VALUES,
  SUPPLIER_STATUS_LABELS,
  SUPPLIER_STATUS_VALUES,
  categoryLabel,
} from "../-utils";

// 这份 schema 是 apps/server/src/modules/supplier/validation.ts 的镜像，**故意抄的**。
//
// 直接 runtime import 服务端那份不行：AGENTS.md 规定 apps/web 对 @repo/server
// 只能 import type，从根 import 会顺着 index.ts → infra/db → pg 把服务端依赖
// 拽进浏览器包。
//
// 现在只有一个模块，两份对照着看得过来；等第 3 个模块也在抄同一批规则时，就该开
// packages/contracts（纯 zod + 类型、零运行时依赖），并把决策写进
// docs/architecture-decisions.md —— 别在只有一个消费方时就建包。
//
// 服务端**始终**是权威校验方，这份只负责让用户在点提交前就看到错误。
const SupplierFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "供应商名称不能为空")
    .max(255, "供应商名称过长"),
  serviceCategories: z
    .array(z.enum(SERVICE_CATEGORY_VALUES))
    .min(1, "请至少选择一个服务类目"),
  city: z.string().trim().min(1, "所在城市不能为空").max(64, "城市名过长"),
  contactPerson: z
    .string()
    .trim()
    .min(1, "联系人不能为空")
    .max(64, "联系人过长"),
  contactPhone: z
    .string()
    .trim()
    .regex(/^[\d\-+()（）\s]{5,20}$/, "请输入正确的联系电话"),
  status: z.enum(SUPPLIER_STATUS_VALUES),
  remark: z.string().trim().max(1000, "备注不超过 1000 字"),
});

type SupplierFormState = z.infer<typeof SupplierFormSchema>;

/** 必填星号统一走这个组件上色，不要在标签文字里直接拼一个黑色的 `*`。 */
function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type SupplierFormDialogProps = {
  open: boolean;
  /** 传了就是编辑，没传就是新增。 */
  supplier?: Supplier;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: SupplierFormValues) => void;
};

export function SupplierFormDialog({
  open,
  supplier,
  submitting,
  onOpenChange,
  onSubmit,
}: SupplierFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{supplier ? "修改供应商" : "新增供应商"}</DialogTitle>
          <DialogDescription>带 * 的是必填项，保存后立即生效。</DialogDescription>
        </DialogHeader>
        {/* key 让切换记录时整个表单重新挂载：比在 effect 里手动 reset 更难写错，
            也不会出现「上一条的校验错误残留到这一条」。Dialog 本身没重挂，
            开关动画不受影响。 */}
        <SupplierForm
          key={supplier?.id ?? "new"}
          supplier={supplier}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function SupplierForm({
  supplier,
  submitting,
  onCancel,
  onSubmit,
}: {
  supplier?: Supplier;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: SupplierFormValues) => void;
}) {
  const defaultValues: SupplierFormState = {
    name: supplier?.name ?? "",
    serviceCategories: supplier?.serviceCategories ?? [],
    city: supplier?.city ?? "",
    contactPerson: supplier?.contactPerson ?? "",
    contactPhone: supplier?.contactPhone ?? "",
    status: supplier?.status ?? "enabled",
    remark: supplier?.remark ?? "",
  };

  const form = useForm({
    defaultValues,
    // 注意：这个 onChange 校验的是**整个 schema**，不是只校验被改动的那个字段——
    // 改一个字段，TanStack Form 会把全表单的校验结果按路径分发给每个 field，
    // 所以光打开表单敲第一个字，所有字段的 field.state.meta.errors 都会立刻非空。
    // 真正防止「满屏飘红」的是下面渲染时的 isTouched 判断，不是这里的 onChange
    // 本身——onChange 只负责让用户离开某个字段后，errors 能跟着后续输入实时更新
    // （不用等下一次 blur 才消失）。
    validators: {
      onChange: SupplierFormSchema,
      onSubmit: SupplierFormSchema,
    },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>
                供应商名称
                <RequiredMark />
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="请输入供应商名称"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={
                  field.state.meta.isTouched && field.state.meta.errors.length > 0
                }
              />
              {/* 只在字段被碰过（blur 过，或提交时被统一标记）之后才显示错误——
                  form 级 onChange 校验的是整个 schema，不加这层判断的话，
                  用户刚敲第一个字，其余全部空着的必填项就会一起飘红。 */}
              <FieldError
                errors={field.state.meta.isTouched ? field.state.meta.errors : []}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="serviceCategories">
          {(field) => (
            <Field>
              <FieldLabel>
                服务类目
                <RequiredMark />
              </FieldLabel>
              {/* Base UI 的 Select 原生支持 multiple，不用另拼 Popover + Command：
                  12 个选项不需要搜索框，多一层组合件只是多一处要维护的键盘交互。 */}
              <Select
                multiple
                items={SERVICE_CATEGORY_LABELS}
                value={field.state.value}
                onValueChange={(value) => {
                  field.handleChange(value as ServiceCategory[]);
                  // Select 关闭时不会触发原生 blur 事件，得手动标记，
                  // 否则选完类目错误提示要等用户点别处才会消失。
                  field.handleBlur();
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-invalid={
                    field.state.meta.isTouched && field.state.meta.errors.length > 0
                  }
                  onBlur={field.handleBlur}
                >
                  <SelectValue>
                    {(value: ServiceCategory[]) =>
                      value?.length ? (
                        value.map(categoryLabel).join("、")
                      ) : (
                        <span className="text-muted-foreground">
                          请选择服务类目
                        </span>
                      )
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORY_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {categoryLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError
                errors={field.state.meta.isTouched ? field.state.meta.errors : []}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="city">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>
                所在城市
                <RequiredMark />
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="请输入城市"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={
                  field.state.meta.isTouched && field.state.meta.errors.length > 0
                }
              />
              <FieldError
                errors={field.state.meta.isTouched ? field.state.meta.errors : []}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="contactPerson">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>
                联系人
                <RequiredMark />
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="请输入联系人"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={
                  field.state.meta.isTouched && field.state.meta.errors.length > 0
                }
              />
              <FieldError
                errors={field.state.meta.isTouched ? field.state.meta.errors : []}
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
                name={field.name}
                placeholder="请输入联系电话"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={
                  field.state.meta.isTouched && field.state.meta.errors.length > 0
                }
              />
              <FieldError
                errors={field.state.meta.isTouched ? field.state.meta.errors : []}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="status">
          {(field) => (
            <Field>
              <FieldLabel>
                供应商状态
                <RequiredMark />
              </FieldLabel>
              <Select
                items={SUPPLIER_STATUS_LABELS}
                value={field.state.value}
                onValueChange={(value) =>
                  field.handleChange(value as SupplierFormState["status"])
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPLIER_STATUS_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {SUPPLIER_STATUS_LABELS[value]}
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
            <FieldLabel htmlFor={field.name}>备注 / 说明</FieldLabel>
            <Textarea
              id={field.name}
              name={field.name}
              rows={4}
              placeholder="记录服务偏好、沟通注意事项等普通说明"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={
                field.state.meta.isTouched && field.state.meta.errors.length > 0
              }
            />
            <FieldError
              errors={field.state.meta.isTouched ? field.state.meta.errors : []}
            />
          </Field>
        )}
      </form.Field>

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
