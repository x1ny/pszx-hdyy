import { useForm } from "@tanstack/react-form";
import { Loader2Icon } from "lucide-react";
import { z } from "zod";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
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
  FieldDescription,
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
import { toDateTimeLocalValue } from "../../-utils";
import type { AgendaLine, Segment } from "../-queries";
import {
  lineLabel,
  SEGMENT_TYPE_LABELS,
  SEGMENT_TYPE_VALUES,
} from "../-utils";

// 镜像 apps/server/src/modules/agenda/validation.ts 的 SegmentFields，
// 手抄一份的原因和边界见 supplier-form-dialog.tsx 顶部的说明。
//
// **没有"线路内顺序"**：同一议程线内时间重叠是阻断的，时间已经把线内顺序
// 全序了，再手填一个顺序号只会和时间打架（BR-DEV-031：顺序调整通过编辑
// 时间完成）。列表里的顺序号是算出来的。
const SegmentFormSchema = z
  .object({
    name: z.string().trim().min(1, "环节名称不能为空").max(255, "环节名称过长"),
    segmentType: z.enum(SEGMENT_TYPE_VALUES),
    // "main" | "new" | String(lineId)——用字符串是因为 Select 的取值本来就是
    // 字符串，混着 null/number 反而要在每个回调里做一次转换。
    lineKey: z.string(),
    newLineName: z.string().trim().max(64, "线路名称过长"),
    startTime: z.string().min(1, "开始时间不能为空"),
    endTime: z.string().min(1, "结束时间不能为空"),
    locationText: z.string().trim().max(255, "地点过长"),
    ownerName: z.string().trim().max(64, "负责人过长"),
    description: z.string().trim().max(2000, "说明不超过 2000 字"),
    memberEnabled: z.boolean(),
    seatingEnabled: z.boolean(),
  })
  // `<=` 而不是 `<`：允许零时长的瞬时环节（签到、剪彩），和服务端一致。
  .refine(
    (value) =>
      !value.startTime ||
      !value.endTime ||
      new Date(value.startTime) <= new Date(value.endTime),
    { message: "结束时间不能早于开始时间", path: ["endTime"] },
  )
  .refine((value) => value.lineKey !== "new" || value.newLineName.length > 0, {
    message: "新建并行线必须填写线路名称",
    path: ["newLineName"],
  });

type SegmentFormState = z.infer<typeof SegmentFormSchema>;

/**
 * 表单交出去的形状。`agendaLineId: null` 表示主线（服务端懒创建）；
 * `newLineName` 有值时由页面先建并行线再建环节——这样"在新并行线上加一个
 * 环节"是一次保存动作，不用先关掉表单去别处建线。
 */
export type SegmentFormSubmitValues = {
  name: string;
  segmentType: Segment["segmentType"];
  agendaLineId: number | null;
  newLineName?: string;
  startTime: Date;
  endTime: Date;
  locationText?: string;
  ownerName?: string;
  description?: string;
  memberEnabled: boolean;
  seatingEnabled: boolean;
};

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type SegmentFormDialogProps = {
  open: boolean;
  /** 传了就是编辑，没传就是新增 */
  segment?: Segment;
  lines: AgendaLine[];
  /** 活动的起止时间，用来提示"环节排到了活动时间之外" */
  activityRange: { start: string; end: string };
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: SegmentFormSubmitValues) => void;
};

export function SegmentFormDialog({
  open,
  segment,
  lines,
  activityRange,
  submitting,
  onOpenChange,
  onSubmit,
}: SegmentFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{segment ? "修改环节" : "新增环节"}</DialogTitle>
          <DialogDescription>
            基础字段和议程线合法即可保存，不要求先配好场地、排位或资源。
            同一条议程线上的环节时间不能重叠；需要同时进行的环节请放到并行线。
          </DialogDescription>
        </DialogHeader>
        <SegmentForm
          // 切换编辑对象时整体重挂载，避免上一条的校验错误残留到这一条
          key={segment?.id ?? "new"}
          segment={segment}
          lines={lines}
          activityRange={activityRange}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function SegmentForm({
  segment,
  lines,
  activityRange,
  submitting,
  onCancel,
  onSubmit,
}: {
  segment?: Segment;
  lines: AgendaLine[];
  activityRange: { start: string; end: string };
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: SegmentFormSubmitValues) => void;
}) {
  const mainLine = lines.find((line) => line.lineType === "main");
  const parallelLines = lines.filter((line) => line.lineType === "parallel");

  const currentKey = (() => {
    if (!segment) return "main";
    if (mainLine && segment.agendaLineId === mainLine.id) return "main";
    return String(segment.agendaLineId);
  })();

  const defaultValues: SegmentFormState = {
    name: segment?.name ?? "",
    segmentType: segment?.segmentType ?? "other",
    lineKey: currentKey,
    newLineName: "",
    startTime: toDateTimeLocalValue(segment?.startTime),
    endTime: toDateTimeLocalValue(segment?.endTime),
    locationText: segment?.locationText ?? "",
    ownerName: segment?.ownerName ?? "",
    description: segment?.description ?? "",
    memberEnabled: segment?.memberEnabled ?? false,
    seatingEnabled: segment?.seatingEnabled ?? false,
  };

  const form = useForm({
    defaultValues,
    validators: { onChange: SegmentFormSchema, onSubmit: SegmentFormSchema },
    onSubmit: ({ value }) =>
      onSubmit({
        name: value.name,
        segmentType: value.segmentType,
        agendaLineId:
          value.lineKey === "main" || value.lineKey === "new"
            ? null
            : Number(value.lineKey),
        newLineName: value.lineKey === "new" ? value.newLineName : undefined,
        startTime: new Date(value.startTime),
        endTime: new Date(value.endTime),
        locationText: value.locationText || undefined,
        ownerName: value.ownerName || undefined,
        description: value.description || undefined,
        memberEnabled: value.memberEnabled,
        seatingEnabled: value.seatingEnabled,
      }),
  });

  const lineItems = [
    { value: "main", label: mainLine ? lineLabel(mainLine) : "主线" },
    ...parallelLines.map((line) => ({
      value: String(line.id),
      label: lineLabel(line),
    })),
    { value: "new", label: "＋ 新建并行线…" },
  ];

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
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor={field.name}>
                环节名称
                <RequiredMark />
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="例如：开幕式、主题演讲"
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

        <form.Field name="segmentType">
          {(field) => (
            <Field>
              <FieldLabel>
                环节类型
                <RequiredMark />
              </FieldLabel>
              <Select
                items={SEGMENT_TYPE_LABELS}
                value={field.state.value}
                onValueChange={(value) => {
                  field.handleChange(value as SegmentFormState["segmentType"]);
                  // Select 关闭时不触发原生 blur，手动补一次，否则错误提示
                  // 要等用户点别处才消失
                  field.handleBlur();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEGMENT_TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {SEGMENT_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>

        <form.Field name="lineKey">
          {(field) => (
            <Field>
              <FieldLabel>
                议程线
                <RequiredMark />
              </FieldLabel>
              <Select
                items={lineItems}
                value={field.state.value}
                onValueChange={(value) => {
                  field.handleChange(String(value));
                  field.handleBlur();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lineItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                主线只能有一条，画在时间轴第一层；需要和主线同时进行的环节
                放并行线。
              </FieldDescription>
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.lineKey}>
          {(lineKey) =>
            lineKey === "new" ? (
              <form.Field name="newLineName">
                {(field) => (
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor={field.name}>
                      新并行线名称
                      <RequiredMark />
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      placeholder="例如：分论坛 A"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors.length > 0
                      }
                    />
                    <FieldDescription>
                      保存时会先创建这条并行线，再把环节放上去。
                    </FieldDescription>
                    <FieldError
                      errors={
                        field.state.meta.isTouched
                          ? field.state.meta.errors
                          : []
                      }
                    />
                  </Field>
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>

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

        {/* 超出活动时间范围只提示不阻断——C-016：本期业务冲突允许保存但提示 */}
        <form.Subscribe
          selector={(state) => [state.values.startTime, state.values.endTime]}
        >
          {([start, end]) => {
            const outside =
              (start && new Date(start) < new Date(activityRange.start)) ||
              (end && new Date(end) > new Date(activityRange.end));
            return outside ? (
              <p className="text-warning-foreground text-xs sm:col-span-2">
                提示：环节时间超出了活动的起止范围，仍可保存，但请确认不是填错了。
              </p>
            ) : null;
          }}
        </form.Subscribe>

        <form.Field name="locationText">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>地点 / 区域</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="例如：主会场、6号馆 A区"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="ownerName">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>环节负责人</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                placeholder="填写姓名"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:gap-8">
          <form.Field name="memberEnabled">
            {(field) => (
              <Field
                orientation="horizontal"
                className="flex-row-reverse justify-end gap-2"
              >
                <Checkbox
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(!!checked)}
                />
                <div>
                  <FieldLabel htmlFor={field.name}>开启环节人员管理</FieldLabel>
                  <FieldDescription>
                    本期只是标记，人员模块建成后在这里接入。
                  </FieldDescription>
                </div>
              </Field>
            )}
          </form.Field>

          <form.Field name="seatingEnabled">
            {(field) => (
              <Field
                orientation="horizontal"
                className="flex-row-reverse justify-end gap-2"
              >
                <Checkbox
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(!!checked)}
                />
                <div>
                  <FieldLabel htmlFor={field.name}>开启排位管理</FieldLabel>
                  <FieldDescription>
                    本期只是标记，不要求先配好场地空间或排位方案。
                  </FieldDescription>
                </div>
              </Field>
            )}
          </form.Field>
        </div>
      </div>

      <form.Field name="description">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>环节说明</FieldLabel>
            <Textarea
              id={field.name}
              name={field.name}
              rows={3}
              placeholder="补充说明，例如流程要点、注意事项"
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
          保存环节
        </Button>
      </DialogFooter>
    </form>
  );
}
