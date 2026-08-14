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
import type { Project, ProjectFormValues } from "../-queries";
import {
  PUBLISH_STATUS_LABELS,
  PUBLISH_STATUS_VALUES,
  toDateTimeLocalValue,
} from "../-utils";

// 这份 schema 是 apps/server/src/modules/project/validation.ts 的 ProjectInput
// 镜像，故意抄的——见 supplier-form-dialog.tsx 顶部同一段注释，原因和边界
// 没有变化。这里额外多一层：表单里的时间字段是 <input type="datetime-local">
// 天生的字符串（""=没填），提交时才转成 Date | undefined，不在表单状态里
// 直接存 Date——受控输入的 value 只能是字符串，存 Date 还要再转一遍格式。
const ProjectFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "项目名称不能为空")
      .max(255, "项目名称过长"),
    location: z.string().trim().max(255, "地点过长"),
    startTime: z.string(),
    endTime: z.string(),
    totalBudget: z.string(),
    hostOrg: z.string().trim().max(255, "主办单位过长"),
    organizerOrg: z.string().trim().max(255, "承办单位过长"),
    supportOrg: z.string().trim().max(255, "支持单位过长"),
    guidingOrg: z.string().trim().max(255, "指导单位过长"),
    description: z.string().trim().max(2000, "简介不超过 2000 字"),
    publishStatus: z.enum(PUBLISH_STATUS_VALUES),
  })
  .refine(
    (value) =>
      !value.startTime ||
      !value.endTime ||
      new Date(value.startTime) < new Date(value.endTime),
    { message: "结束时间必须晚于开始时间", path: ["endTime"] },
  );

type ProjectFormState = z.infer<typeof ProjectFormSchema>;

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type ProjectFormDialogProps = {
  open: boolean;
  /** 传了就是编辑，没传就是新增。 */
  project?: Project;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ProjectFormValues) => void;
};

export function ProjectFormDialog({
  open,
  project,
  submitting,
  onOpenChange,
  onSubmit,
}: ProjectFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{project ? "修改项目" : "新增项目"}</DialogTitle>
          <DialogDescription>
            带 * 的是必填项。项目时间范围可以先不填——立项时往往还没定具体档期，
            旗下活动会各自有自己的确定时间。
          </DialogDescription>
        </DialogHeader>
        {/* key 让切换记录时整个表单重新挂载，见 supplier-form-dialog.tsx 的
            同一段说明。 */}
        <ProjectForm
          key={project?.id ?? "new"}
          project={project}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  project,
  submitting,
  onCancel,
  onSubmit,
}: {
  project?: Project;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: ProjectFormValues) => void;
}) {
  const defaultValues: ProjectFormState = {
    name: project?.name ?? "",
    location: project?.location ?? "",
    startTime: toDateTimeLocalValue(project?.startTime),
    endTime: toDateTimeLocalValue(project?.endTime),
    totalBudget: project?.totalBudget ?? "",
    hostOrg: project?.hostOrg ?? "",
    organizerOrg: project?.organizerOrg ?? "",
    supportOrg: project?.supportOrg ?? "",
    guidingOrg: project?.guidingOrg ?? "",
    description: project?.description ?? "",
    publishStatus: project?.publishStatus ?? "draft",
  };

  const form = useForm({
    defaultValues,
    validators: { onChange: ProjectFormSchema, onSubmit: ProjectFormSchema },
    onSubmit: ({ value }) =>
      onSubmit({
        name: value.name,
        location: value.location || undefined,
        startTime: value.startTime ? new Date(value.startTime) : undefined,
        endTime: value.endTime ? new Date(value.endTime) : undefined,
        totalBudget:
          value.totalBudget === "" ? undefined : Number(value.totalBudget),
        hostOrg: value.hostOrg || undefined,
        organizerOrg: value.organizerOrg || undefined,
        supportOrg: value.supportOrg || undefined,
        guidingOrg: value.guidingOrg || undefined,
        description: value.description || undefined,
        publishStatus: value.publishStatus,
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
                项目名称
                <RequiredMark />
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="请输入项目名称"
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

        <form.Field name="location">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>项目地点</FieldLabel>
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
                placeholder="不填表示暂未核定预算"
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
              <FieldLabel htmlFor={field.name}>开始时间</FieldLabel>
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
              <FieldLabel htmlFor={field.name}>结束时间</FieldLabel>
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
                  field.handleChange(value as ProjectFormState["publishStatus"])
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
        </div>

      <form.Field name="description">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>项目简介</FieldLabel>
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
