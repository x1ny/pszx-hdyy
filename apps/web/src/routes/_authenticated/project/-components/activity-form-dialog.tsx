import { useForm } from "@tanstack/react-form";
import { Loader2Icon } from "lucide-react";
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
import type { Activity, ActivityFormValues } from "../-queries";
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_VALUES,
  PUBLISH_STATUS_LABELS,
  PUBLISH_STATUS_VALUES,
  toDateTimeLocalValue,
} from "../-utils";

// 镜像 apps/server/src/modules/project/validation.ts 的 ActivityFields，
// 原因和边界见 supplier-form-dialog.tsx 顶部的同一段说明。
// **没有 projectId**：活动永远从项目详情页创建，projectId 由外层传入，
// 不是这份表单里用户能改的一个字段。
const ActivityFormSchema = z
  .object({
    activityType: z.enum(ACTIVITY_TYPE_VALUES),
    name: z.string().trim().min(1, "活动名称不能为空").max(255, "活动名称过长"),
    location: z.string().trim().max(255, "地点过长"),
    startTime: z.string().min(1, "开始时间不能为空"),
    endTime: z.string().min(1, "结束时间不能为空"),
    totalBudget: z.string(),
    hostOrg: z.string().trim().max(255, "主办单位过长"),
    organizerOrg: z.string().trim().max(255, "承办单位过长"),
    supportOrg: z.string().trim().max(255, "支持单位过长"),
    guidingOrg: z.string().trim().max(255, "指导单位过长"),
    description: z.string().trim().max(2000, "简介不超过 2000 字"),
    publishStatus: z.enum(PUBLISH_STATUS_VALUES),
    displayEnabled: z.boolean(),
    registrationEnabled: z.boolean(),
  })
  .refine(
    (value) =>
      !value.startTime ||
      !value.endTime ||
      new Date(value.startTime) < new Date(value.endTime),
    { message: "结束时间必须晚于开始时间", path: ["endTime"] },
  );

type ActivityFormState = z.infer<typeof ActivityFormSchema>;

/** 表单往外交的形状：跟 ActivityFormValues 一样，就是少了 projectId。 */
export type ActivityFormSubmitValues = Omit<ActivityFormValues, "projectId">;

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type ActivityFormDialogProps = {
  open: boolean;
  /** 传了就是编辑，没传就是新增。 */
  activity?: Activity;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ActivityFormSubmitValues) => void;
};

export function ActivityFormDialog({
  open,
  activity,
  submitting,
  onOpenChange,
  onSubmit,
}: ActivityFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{activity ? "修改活动" : "新增活动"}</DialogTitle>
          <DialogDescription>
            带 * 的是必填项。活动时间必须填写——环节、议程、报名等后续能力
            都要挂在真实的开始/结束时刻上。
          </DialogDescription>
        </DialogHeader>
        <ActivityForm
          key={activity?.id ?? "new"}
          activity={activity}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function ActivityForm({
  activity,
  submitting,
  onCancel,
  onSubmit,
}: {
  activity?: Activity;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: ActivityFormSubmitValues) => void;
}) {
  const defaultValues: ActivityFormState = {
    activityType: activity?.activityType ?? "standalone",
    name: activity?.name ?? "",
    location: activity?.location ?? "",
    startTime: toDateTimeLocalValue(activity?.startTime),
    endTime: toDateTimeLocalValue(activity?.endTime),
    totalBudget: activity?.totalBudget ?? "",
    hostOrg: activity?.hostOrg ?? "",
    organizerOrg: activity?.organizerOrg ?? "",
    supportOrg: activity?.supportOrg ?? "",
    guidingOrg: activity?.guidingOrg ?? "",
    description: activity?.description ?? "",
    publishStatus: activity?.publishStatus ?? "draft",
    displayEnabled: activity?.displayEnabled ?? false,
    registrationEnabled: activity?.registrationEnabled ?? false,
  };

  const form = useForm({
    defaultValues,
    validators: { onChange: ActivityFormSchema, onSubmit: ActivityFormSchema },
    onSubmit: ({ value }) =>
      onSubmit({
        activityType: value.activityType,
        name: value.name,
        location: value.location || undefined,
        startTime: new Date(value.startTime),
        endTime: new Date(value.endTime),
        totalBudget:
          value.totalBudget === "" ? undefined : Number(value.totalBudget),
        hostOrg: value.hostOrg || undefined,
        organizerOrg: value.organizerOrg || undefined,
        supportOrg: value.supportOrg || undefined,
        guidingOrg: value.guidingOrg || undefined,
        description: value.description || undefined,
        publishStatus: value.publishStatus,
        displayEnabled: value.displayEnabled,
        registrationEnabled: value.registrationEnabled,
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
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="name">
            {(field) => (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={field.name}>
                  活动名称
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="请输入活动名称"
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

          <form.Field name="activityType">
            {(field) => (
              <Field>
                <FieldLabel>
                  活动类型
                  <RequiredMark />
                </FieldLabel>
                <Select
                  items={ACTIVITY_TYPE_LABELS}
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(
                      value as ActivityFormState["activityType"],
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPE_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ACTIVITY_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="location">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>活动地点</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="请输入地点"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="totalBudget">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>总预算（元）</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  min={0}
                  step="0.01"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="startTime">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  开始时间
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="datetime-local"
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

          <form.Field name="endTime">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  结束时间
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="datetime-local"
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

          <form.Field name="hostOrg">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>主办单位</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="organizerOrg">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>承办单位</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="supportOrg">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>支持单位</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="guidingOrg">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>指导单位</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="publishStatus">
            {(field) => (
              <Field>
                <FieldLabel>发布状态</FieldLabel>
                <Select
                  items={PUBLISH_STATUS_LABELS}
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(
                      value as ActivityFormState["publishStatus"],
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUBLISH_STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PUBLISH_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          {/**
           * H5 展示开关和报名开关本期不出现在表单里：两个都只控制 H5 的行为，
           * 而 H5 不建（AGENTS.md）。
           *
           * ⚠️ 只是**不渲染控件，不是从表单里拿掉字段**。`defaultValues` 照常
           * 从活动读这两个值，`onSubmit` 照常原样交回去——否则编辑一次活动就
           * 会把它们静默重置成 false，而界面上根本没有能让人看出这件事的东西。
           * H5 上马时把这一段换回两个 Checkbox 即可，schema 和提交逻辑不用动。
           */}
        </div>

        <form.Field name="description">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>活动简介</FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                rows={4}
                placeholder="面向公众展示的简介，暂不支持富文本排版"
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
