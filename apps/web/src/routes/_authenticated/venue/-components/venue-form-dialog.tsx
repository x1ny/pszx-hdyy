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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { Textarea } from "#/shared/components/ui/textarea.tsx";
import type { Venue, VenueFormValues } from "../-queries";
import { VENUE_STATUS_LABELS, VENUE_STATUS_VALUES } from "../-utils";

// 这份 schema 是 apps/server/src/modules/venue/validation.ts 的镜像，故意抄的：
// apps/web 对 @repo/server 只能 import type，runtime import 会把 pg 之类的
// 服务端依赖拽进浏览器包。服务端始终是权威校验方，这份只让用户在提交前看到错误。
const VenueFormSchema = z.object({
  name: z.string().trim().min(1, "场地名称不能为空").max(255, "场地名称过长"),
  address: z.string().trim().max(255, "地址过长"),
  description: z.string().trim().max(1000, "说明不超过 1000 字"),
  status: z.enum(VENUE_STATUS_VALUES),
});

type VenueFormState = z.infer<typeof VenueFormSchema>;

/** 必填星号单独上色，不要把 `*` 拼进标签文字（会跟着变成普通黑字）。 */
function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type VenueFormDialogProps = {
  open: boolean;
  /** 传了就是编辑，没传就是新增。 */
  venue?: Venue;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: VenueFormValues) => void;
};

export function VenueFormDialog({
  open,
  venue,
  submitting,
  onOpenChange,
  onSubmit,
}: VenueFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader
          title={venue ? "修改场地" : "新增场地"}
          description="这里只填场地的基本信息，区域和位置在「区域与位置」页里维护。"
        />
        {/* key 让切换记录时整个表单重新挂载，避免上一条的校验错误残留到这一条。 */}
        <VenueForm
          key={venue?.id ?? "new"}
          venue={venue}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function VenueForm({
  venue,
  submitting,
  onCancel,
  onSubmit,
}: {
  venue?: Venue;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: VenueFormValues) => void;
}) {
  const defaultValues: VenueFormState = {
    name: venue?.name ?? "",
    address: venue?.address ?? "",
    description: venue?.description ?? "",
    status: venue?.status ?? "enabled",
  };

  const form = useForm({
    defaultValues,
    validators: { onChange: VenueFormSchema, onSubmit: VenueFormSchema },
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
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>
                场地名称
                <RequiredMark />
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="例如：泉州海丝艺术公园主秀场"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={
                  field.state.meta.isTouched &&
                  field.state.meta.errors.length > 0
                }
              />
              {/* 只在字段被碰过之后才显示错误：form 级 onChange 校验的是整个
                  schema，不加这层判断的话刚敲第一个字全部必填项就一起飘红。 */}
              <FieldError
                errors={
                  field.state.meta.isTouched ? field.state.meta.errors : []
                }
              />
            </Field>
          )}
        </form.Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="address">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>地址</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="城市或详细地址"
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

          <form.Field name="status">
            {(field) => (
              <Field>
                <FieldLabel>状态</FieldLabel>
                <Select
                  items={VENUE_STATUS_LABELS}
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value as VenueFormState["status"]);
                    // Select 关闭不触发原生 blur，手动标记一次。
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VENUE_STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {VENUE_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError
                  errors={
                    field.state.meta.isTouched ? field.state.meta.errors : []
                  }
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="description">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>说明</FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                rows={3}
                placeholder="场地的补充说明，例如可容纳规模、周边交通"
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
