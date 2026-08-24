import { useForm } from "@tanstack/react-form";
import { Loader2Icon } from "lucide-react";
import { z } from "zod";
import type {
  Trip,
  TripFormValues,
  TripOptions,
} from "#/features/trip/queries.ts";
import {
  TRANSPORT_MODE_LABELS,
  TRANSPORT_MODE_VALUES,
} from "#/features/trip/utils.ts";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "#/shared/components/ui/combobox.tsx";
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
  FieldGroup,
  FieldLabel,
} from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { toDateTimeLocalValue } from "../../-utils";

const TripFormSchema = z
  .object({
    activityMemberId: z.number().int().positive("请选择人员"),
    segmentId: z.number().int().positive().nullable(),
    transportMode: z
      .enum(TRANSPORT_MODE_VALUES)
      .nullable()
      .refine((value) => value !== null, "请选择交通方式"),
    serviceNumber: z.string().trim().max(64, "航班/车次过长"),
    departureTime: z.string().min(1, "出发时间不能为空"),
    arrivalTime: z.string().min(1, "到达时间不能为空"),
    departureLocation: z
      .string()
      .trim()
      .min(1, "出发地不能为空")
      .max(255, "出发地过长"),
    destination: z
      .string()
      .trim()
      .min(1, "目的地不能为空")
      .max(255, "目的地过长"),
  })
  .refine(
    (value) =>
      !value.departureTime ||
      !value.arrivalTime ||
      new Date(value.departureTime) < new Date(value.arrivalTime),
    { message: "到达时间必须晚于出发时间", path: ["arrivalTime"] },
  );

type TripFormState = z.input<typeof TripFormSchema>;
export type TripFormSubmitValues = Omit<TripFormValues, "activityId">;

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type TripFormDialogProps = {
  open: boolean;
  activityName: string;
  trip?: Trip;
  options?: TripOptions;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TripFormSubmitValues) => void;
};

export function TripFormDialog({
  open,
  activityName,
  trip,
  options,
  submitting,
  onOpenChange,
  onSubmit,
}: TripFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader
          title={trip ? "修改行程" : "新增行程"}
          description="行程绑定当前活动人员；关联环节和航班/车次可以不填。"
        />
        <TripForm
          key={trip?.id ?? "new"}
          activityName={activityName}
          trip={trip}
          options={options}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function TripForm({
  activityName,
  trip,
  options,
  submitting,
  onCancel,
  onSubmit,
}: Omit<TripFormDialogProps, "open" | "onOpenChange"> & {
  onCancel: () => void;
}) {
  const defaultValues: TripFormState = {
    activityMemberId: trip?.activityMemberId ?? 0,
    segmentId: trip?.segmentId ?? null,
    transportMode: trip?.transportMode ?? null,
    serviceNumber: trip?.serviceNumber ?? "",
    departureTime: toDateTimeLocalValue(trip?.departureTime),
    arrivalTime: toDateTimeLocalValue(trip?.arrivalTime),
    departureLocation: trip?.departureLocation ?? "",
    destination: trip?.destination ?? "",
  };

  const form = useForm({
    defaultValues,
    validators: { onChange: TripFormSchema, onSubmit: TripFormSchema },
    onSubmit: ({ value }) => {
      if (value.transportMode === null) return;
      onSubmit({
        activityMemberId: value.activityMemberId,
        segmentId: value.segmentId,
        transportMode: value.transportMode,
        serviceNumber: value.serviceNumber || undefined,
        departureTime: new Date(value.departureTime),
        arrivalTime: new Date(value.arrivalTime),
        departureLocation: value.departureLocation,
        destination: value.destination,
      });
    },
  });

  const members = options?.members ?? [];
  const memberItems = members.map((item) => ({
    value: item.activityMemberId,
    label: item.name,
  }));
  const segments = options?.segments ?? [];

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <DialogBody>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled>
            <FieldLabel>关联活动</FieldLabel>
            <Input disabled value={activityName} />
          </Field>

          <form.Field name="segmentId">
            {(field) => (
              <Field>
                <FieldLabel>关联环节</FieldLabel>
                <Select
                  items={[
                    { value: null, label: "不关联环节" },
                    ...segments.map((segment) => ({
                      value: segment.id,
                      label: `${segment.name}${segment.status === "voided" ? "（已作废）" : ""}`,
                    })),
                  ]}
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value == null ? null : Number(value));
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger className="w-full" onBlur={field.handleBlur}>
                    <SelectValue placeholder="请选择环节" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={null}>不关联环节</SelectItem>
                      {segments.map((segment) => (
                        <SelectItem key={segment.id} value={segment.id}>
                          {segment.name}
                          {segment.status === "voided" ? "（已作废）" : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="activityMemberId">
            {(field) => {
              const invalid =
                field.state.meta.isTouched &&
                field.state.meta.errors.length > 0;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>
                    姓名
                    <RequiredMark />
                  </FieldLabel>
                  <Combobox
                    items={memberItems}
                    value={
                      memberItems.find(
                        (item) => item.value === field.state.value,
                      ) ?? null
                    }
                    itemToStringLabel={(item) => item.label}
                    itemToStringValue={(item) => String(item.value)}
                    onValueChange={(value) => {
                      field.handleChange(value?.value ?? 0);
                      field.handleBlur();
                    }}
                  >
                    <ComboboxInput
                      id={field.name}
                      className="w-full"
                      placeholder="请选择或搜索人员"
                      aria-invalid={invalid}
                      onBlur={field.handleBlur}
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>没有匹配的人员</ComboboxEmpty>
                      <ComboboxList>
                        {(item) => (
                          <ComboboxItem key={item.value} value={item}>
                            {item.label}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldError
                    errors={
                      field.state.meta.isTouched ? field.state.meta.errors : []
                    }
                  />
                </Field>
              );
            }}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.activityMemberId}>
            {(activityMemberId) => (
              <Field data-disabled>
                <FieldLabel>企业（社会）职务</FieldLabel>
                <Input
                  disabled
                  value={
                    members.find(
                      (item) => item.activityMemberId === activityMemberId,
                    )?.companyPosition ?? ""
                  }
                  placeholder="选择人员后自动带入"
                />
              </Field>
            )}
          </form.Subscribe>

          <form.Field name="transportMode">
            {(field) => {
              const invalid =
                field.state.meta.isTouched &&
                field.state.meta.errors.length > 0;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel>
                    交通方式
                    <RequiredMark />
                  </FieldLabel>
                  <Select
                    items={TRANSPORT_MODE_LABELS}
                    value={field.state.value}
                    onValueChange={(value) => {
                      field.handleChange(
                        value == null
                          ? null
                          : (value as Exclude<
                              TripFormState["transportMode"],
                              null
                            >),
                      );
                      field.handleBlur();
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-invalid={invalid}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue placeholder="请选择交通方式" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {TRANSPORT_MODE_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {TRANSPORT_MODE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldError
                    errors={
                      field.state.meta.isTouched ? field.state.meta.errors : []
                    }
                  />
                </Field>
              );
            }}
          </form.Field>

          <form.Field name="serviceNumber">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>航班/车次</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="请输入航班/车次"
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

          <form.Field name="departureTime">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  出发时间
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

          <form.Field name="arrivalTime">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  到达时间
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

          <form.Field name="departureLocation">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  出发地
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="请输入出发地"
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

          <form.Field name="destination">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  目的地
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="请输入目的地"
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
        </FieldGroup>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          )}
          保存
        </Button>
      </DialogFooter>
    </form>
  );
}
