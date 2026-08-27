import { useForm } from "@tanstack/react-form";
import { AlertCircleIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import {
  TRANSPORT_MODE_LABELS,
  TRANSPORT_MODE_VALUES,
} from "#/features/trip/utils.ts";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
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
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import type { CreateBatchTripsValues, TripBatchOptions } from "../-queries";
import {
  batchMembersForOrganization,
  reconcileBatchScope,
  selectBatchOrganization,
  synchronizeBatchSelection,
  type TripBatchSelection,
  toggleBatchMember,
} from "./trip-batch-selection";

const TripBatchPayloadSchema = z
  .object({
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

type TripBatchPayloadState = z.input<typeof TripBatchPayloadSchema>;

const TRANSPORT_ITEMS = TRANSPORT_MODE_VALUES.map((value) => ({
  value,
  label: TRANSPORT_MODE_LABELS[value],
}));

const EMPTY_SELECTION: TripBatchSelection = {
  organizationId: null,
  activityMemberIds: [],
};

const EMPTY_OPTIONS: TripBatchOptions = {
  organizations: [],
  members: [],
};

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

type TripBatchDialogProps = {
  open: boolean;
  activityId: number;
  activityName: string;
  segmentId: number | null;
  segments: readonly { id: number; name: string }[];
  options?: TripBatchOptions;
  optionsPending: boolean;
  optionsError?: Error | null;
  submitError?: Error | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSegmentChange: (segmentId: number | null) => void;
  onRetryOptions: () => void;
  onClearSubmitError: () => void;
  onSubmit: (values: CreateBatchTripsValues) => void;
};

export function TripBatchDialog({
  open,
  activityId,
  activityName,
  segmentId,
  segments,
  options,
  optionsPending,
  optionsError,
  submitError,
  submitting,
  onOpenChange,
  onSegmentChange,
  onRetryOptions,
  onClearSubmitError,
  onSubmit,
}: TripBatchDialogProps) {
  const [selection, setSelection] =
    useState<TripBatchSelection>(EMPTY_SELECTION);
  const [scopeErrors, setScopeErrors] = useState<{
    organization?: string;
    members?: string;
  }>({});
  const resolvedScopeRef = useRef<string | undefined>(undefined);
  const lastResolvedOptionsRef = useRef<TripBatchOptions>(EMPTY_OPTIONS);
  const scopeKey = `${activityId}:${segmentId ?? "activity"}`;

  useEffect(() => {
    if (!options) return;
    const scopeChanged = resolvedScopeRef.current !== scopeKey;
    resolvedScopeRef.current = scopeKey;
    setSelection((current) =>
      scopeChanged
        ? reconcileBatchScope(current.organizationId, options)
        : synchronizeBatchSelection(current, options),
    );
  }, [options, scopeKey]);

  useEffect(() => {
    if (options) lastResolvedOptionsRef.current = options;
  }, [options]);

  // 新范围加载时保留上一份下拉选项，避免受控 Select 因当前 value 暂时不在
  // items 中而主动清空团体。成员区域此时仍显示骨架屏，不会暴露旧范围人员；
  // 新响应回来后，上面的 reconcile 会按服务端范围决定保留或清空团体。
  const currentOptions = options ?? lastResolvedOptionsRef.current;
  const eligibleMembers = useMemo(
    () => batchMembersForOrganization(currentOptions, selection.organizationId),
    [currentOptions, selection.organizationId],
  );
  const selectedSet = useMemo(
    () => new Set(selection.activityMemberIds),
    [selection.activityMemberIds],
  );
  const allSelected =
    eligibleMembers.length > 0 &&
    eligibleMembers.every((member) => selectedSet.has(member.activityMemberId));
  const someSelected =
    !allSelected &&
    eligibleMembers.some((member) => selectedSet.has(member.activityMemberId));

  const form = useForm({
    defaultValues: {
      transportMode: null,
      serviceNumber: "",
      departureTime: "",
      arrivalTime: "",
      departureLocation: "",
      destination: "",
    } as TripBatchPayloadState,
    validators: {
      onChange: TripBatchPayloadSchema,
      onSubmit: TripBatchPayloadSchema,
    },
    onSubmit: ({ value }) => {
      if (
        selection.organizationId === null ||
        selection.activityMemberIds.length === 0 ||
        value.transportMode === null
      ) {
        return;
      }
      onSubmit({
        activityId,
        organizationId: selection.organizationId,
        segmentId,
        activityMemberIds: selection.activityMemberIds,
        transportMode: value.transportMode,
        serviceNumber: value.serviceNumber || undefined,
        departureTime: new Date(value.departureTime),
        arrivalTime: new Date(value.arrivalTime),
        departureLocation: value.departureLocation,
        destination: value.destination,
      });
    },
  });

  const markChanged = () => {
    if (submitError) onClearSubmitError();
  };
  const segmentItems = [
    { value: null, label: "活动范围（不限定环节）" },
    ...segments.map((segment) => ({
      value: segment.id,
      label: segment.name,
    })),
  ];
  const organizationItems = [
    { value: null, label: "请选择团体" },
    ...currentOptions.organizations.map((organization) => ({
      value: organization.id,
      label: organization.name,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader
          title="团体批量配置行程"
          description="选择范围和成员后，系统会为每名最终勾选人员分别生成一条独立行程。"
        />

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const organizationError =
              selection.organizationId === null ? "请选择团体" : undefined;
            const membersError =
              selection.activityMemberIds.length === 0
                ? "至少选择一名人员"
                : undefined;
            setScopeErrors({
              organization: organizationError,
              members: membersError,
            });
            if (organizationError || membersError) return;
            form.handleSubmit();
          }}
        >
          <DialogBody>
            <FieldGroup>
              {submitError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>批量创建失败</AlertTitle>
                  <AlertDescription>{submitError.message}</AlertDescription>
                </Alert>
              ) : null}

              {optionsError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>范围选项加载失败</AlertTitle>
                  <AlertDescription>{optionsError.message}</AlertDescription>
                  <AlertAction>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onRetryOptions}
                    >
                      重试
                    </Button>
                  </AlertAction>
                </Alert>
              ) : null}

              <FieldGroup className="grid gap-4 sm:grid-cols-3">
                <Field data-disabled>
                  <FieldLabel htmlFor="trip-batch-activity">
                    关联活动
                  </FieldLabel>
                  <Input
                    id="trip-batch-activity"
                    disabled
                    value={activityName}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="trip-batch-segment">关联环节</FieldLabel>
                  <Select
                    items={segmentItems}
                    value={segmentId}
                    onValueChange={(value) => {
                      setSelection((current) => ({
                        ...current,
                        activityMemberIds: [],
                      }));
                      setScopeErrors({});
                      markChanged();
                      onSegmentChange(value == null ? null : Number(value));
                    }}
                  >
                    <SelectTrigger id="trip-batch-segment" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {segmentItems.map((item) => (
                          <SelectItem
                            key={item.value ?? "activity"}
                            value={item.value}
                          >
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {segmentId === null
                      ? "当前使用活动人员的团体快照范围"
                      : "当前使用所选环节人员的团体快照范围"}
                  </FieldDescription>
                </Field>

                <Field
                  data-invalid={scopeErrors.organization ? true : undefined}
                  data-disabled={optionsPending ? true : undefined}
                >
                  <FieldLabel htmlFor="trip-batch-organization">
                    团体
                    <RequiredMark />
                  </FieldLabel>
                  <Select
                    items={organizationItems}
                    value={selection.organizationId}
                    disabled={optionsPending || !!optionsError}
                    onValueChange={(value) => {
                      const organizationId =
                        value == null ? null : Number(value);
                      setSelection(
                        selectBatchOrganization(currentOptions, organizationId),
                      );
                      setScopeErrors((current) => ({
                        ...current,
                        organization: undefined,
                        members: undefined,
                      }));
                      markChanged();
                    }}
                  >
                    <SelectTrigger
                      id="trip-batch-organization"
                      className="w-full"
                      aria-invalid={!!scopeErrors.organization}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {organizationItems.map((item) => (
                          <SelectItem
                            key={item.value ?? "placeholder"}
                            value={item.value}
                          >
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldError>{scopeErrors.organization}</FieldError>
                  {!optionsPending &&
                  !optionsError &&
                  currentOptions.organizations.length === 0 ? (
                    <FieldDescription>
                      当前范围没有可按团体配置的人员。
                    </FieldDescription>
                  ) : null}
                </Field>
              </FieldGroup>

              <Field data-invalid={scopeErrors.members ? true : undefined}>
                <FieldSet className="gap-3">
                  <FieldLegend className="mb-0" variant="label">
                    最终成员
                    <RequiredMark />
                  </FieldLegend>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldDescription>
                      团体或环节变化后默认全选合法成员，可逐人取消。
                    </FieldDescription>
                    <Badge variant="secondary">
                      已选 {selection.activityMemberIds.length} /{" "}
                      {eligibleMembers.length}
                    </Badge>
                  </div>

                  {optionsPending ? (
                    <FieldGroup className="gap-3">
                      {Array.from({ length: 3 }, (_, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏没有业务身份
                        <Skeleton key={index} className="h-10 w-full" />
                      ))}
                    </FieldGroup>
                  ) : selection.organizationId === null ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <UsersRoundIcon />
                        </EmptyMedia>
                        <EmptyTitle>请先选择团体</EmptyTitle>
                        <EmptyDescription>
                          选择后会默认勾选该团体在当前范围内的全部合法成员。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : eligibleMembers.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <UsersRoundIcon />
                        </EmptyMedia>
                        <EmptyTitle>当前范围没有合法成员</EmptyTitle>
                        <EmptyDescription>
                          请切换团体或环节后重新选择。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <FieldGroup className="gap-3">
                      <Field orientation="horizontal">
                        <Checkbox
                          id="trip-batch-select-all"
                          checked={allSelected}
                          indeterminate={someSelected}
                          onCheckedChange={(checked) => {
                            setSelection((current) => ({
                              ...current,
                              activityMemberIds:
                                checked === true
                                  ? eligibleMembers.map(
                                      (member) => member.activityMemberId,
                                    )
                                  : [],
                            }));
                            setScopeErrors((current) => ({
                              ...current,
                              members: undefined,
                            }));
                            markChanged();
                          }}
                        />
                        <FieldLabel htmlFor="trip-batch-select-all">
                          全选当前团体合法成员
                        </FieldLabel>
                      </Field>

                      <FieldGroup className="max-h-56 gap-1 overflow-y-auto rounded-md border p-2">
                        {eligibleMembers.map((member) => {
                          const checkboxId = `trip-batch-member-${member.activityMemberId}`;
                          return (
                            <Field
                              key={member.activityMemberId}
                              orientation="horizontal"
                            >
                              <Checkbox
                                id={checkboxId}
                                checked={selectedSet.has(
                                  member.activityMemberId,
                                )}
                                onCheckedChange={(checked) => {
                                  setSelection((current) => ({
                                    ...current,
                                    activityMemberIds: toggleBatchMember(
                                      current.activityMemberIds,
                                      member.activityMemberId,
                                      checked === true,
                                      eligibleMembers,
                                    ),
                                  }));
                                  setScopeErrors((current) => ({
                                    ...current,
                                    members: undefined,
                                  }));
                                  markChanged();
                                }}
                              />
                              <FieldContent>
                                <FieldLabel htmlFor={checkboxId}>
                                  {member.name}
                                </FieldLabel>
                                <FieldDescription>
                                  {member.companyPosition ||
                                    "未填写企业（社会）职务"}
                                </FieldDescription>
                              </FieldContent>
                            </Field>
                          );
                        })}
                      </FieldGroup>
                    </FieldGroup>
                  )}
                </FieldSet>
                <FieldError>{scopeErrors.members}</FieldError>
              </Field>

              <FieldSeparator>以下信息将应用到每条独立行程</FieldSeparator>

              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <form.Field name="transportMode">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0;
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor="trip-batch-transport-mode">
                          交通方式
                          <RequiredMark />
                        </FieldLabel>
                        <Select
                          items={TRANSPORT_ITEMS}
                          value={field.state.value}
                          onValueChange={(value) => {
                            field.handleChange(
                              value == null
                                ? null
                                : (value as Exclude<
                                    TripBatchPayloadState["transportMode"],
                                    null
                                  >),
                            );
                            field.handleBlur();
                            markChanged();
                          }}
                        >
                          <SelectTrigger
                            id="trip-batch-transport-mode"
                            className="w-full"
                            aria-invalid={invalid}
                            onBlur={field.handleBlur}
                          >
                            <SelectValue placeholder="请选择交通方式" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {TRANSPORT_ITEMS.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FieldError
                          errors={
                            field.state.meta.isTouched
                              ? field.state.meta.errors
                              : []
                          }
                        />
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="serviceNumber">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0;
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={field.name}>航班/车次</FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          placeholder="请输入航班/车次"
                          value={field.state.value}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            markChanged();
                          }}
                        />
                        <FieldError
                          errors={
                            field.state.meta.isTouched
                              ? field.state.meta.errors
                              : []
                          }
                        />
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="departureTime">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0;
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={field.name}>
                          出发时间
                          <RequiredMark />
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="datetime-local"
                          value={field.state.value}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            markChanged();
                          }}
                        />
                        <FieldError
                          errors={
                            field.state.meta.isTouched
                              ? field.state.meta.errors
                              : []
                          }
                        />
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="arrivalTime">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0;
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={field.name}>
                          到达时间
                          <RequiredMark />
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="datetime-local"
                          value={field.state.value}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            markChanged();
                          }}
                        />
                        <FieldError
                          errors={
                            field.state.meta.isTouched
                              ? field.state.meta.errors
                              : []
                          }
                        />
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="departureLocation">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0;
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={field.name}>
                          出发地
                          <RequiredMark />
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          placeholder="请输入出发地"
                          value={field.state.value}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            markChanged();
                          }}
                        />
                        <FieldError
                          errors={
                            field.state.meta.isTouched
                              ? field.state.meta.errors
                              : []
                          }
                        />
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="destination">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0;
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={field.name}>
                          目的地
                          <RequiredMark />
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          placeholder="请输入目的地"
                          value={field.state.value}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            markChanged();
                          }}
                        />
                        <FieldError
                          errors={
                            field.state.meta.isTouched
                              ? field.state.meta.errors
                              : []
                          }
                        />
                      </Field>
                    );
                  }}
                </form.Field>
              </FieldGroup>
            </FieldGroup>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={submitting || optionsPending || !!optionsError}
            >
              {submitting
                ? "正在批量创建…"
                : `为 ${selection.activityMemberIds.length} 人创建独立行程`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
