import { useForm } from "@tanstack/react-form";
import { Loader2Icon } from "lucide-react";
import { z } from "zod";
import { toDateTimeLocalValue } from "#/features/project/utils";
import {
  DEMAND_HANDLING_LABELS,
  RESOURCE_TYPE_ITEMS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPE_VALUES,
  TRANSPORT_SCENE_ITEMS,
} from "#/features/resource/labels.ts";
import type {
  ResourceDemand,
  ResourceDetail,
  ResourceType,
  TransportScene,
} from "#/features/resource/queries.ts";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
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

/**
 * 镜像 apps/server/src/modules/resource/validation.ts 的 ResourceFields。
 * 手抄一份的原因和边界见 supplier-form-dialog.tsx 顶部的说明——服务端始终是
 * 权威校验方，这一份只是让用户在点保存前就看到错误。
 */
const ResourceFormSchema = z
  .object({
    resourceType: z.enum(RESOURCE_TYPE_VALUES),
    transportScene: z.string(),
    name: z.string().trim().min(1, "资源名称不能为空").max(255, "资源名称过长"),
    quantity: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    location: z.string().trim().max(255, "地点过长"),
    vehicleInfo: z.string().trim().max(128, "车辆信息过长"),
    driverName: z.string().trim().max(64, "司机姓名过长"),
    driverPhone: z.string().trim().max(32, "司机电话过长"),
    ownerName: z.string().trim().max(64, "负责人过长"),
    remark: z.string().trim().max(1000, "备注不超过 1000 字"),
    demandIds: z.array(z.number()),
  })
  .refine(
    (v) => v.resourceType !== "transport" || v.transportScene.length > 0,
    { message: "请选择用车场景", path: ["transportScene"] },
  )
  .refine(
    (v) =>
      !v.startTime ||
      !v.endTime ||
      new Date(v.startTime) <= new Date(v.endTime),
    { message: "结束时间不能早于开始时间", path: ["endTime"] },
  )
  .refine((v) => v.quantity === "" || Number(v.quantity) >= 0, {
    message: "数量不能为负",
    path: ["quantity"],
  });

type ResourceFormState = z.infer<typeof ResourceFormSchema>;

export type ResourceFormSubmitValues = {
  resourceType: ResourceType;
  transportScene: TransportScene | null;
  name: string;
  quantity: number | null;
  startTime: Date | null;
  endTime: Date | null;
  location?: string;
  vehicleInfo?: string;
  driverName?: string;
  driverPhone?: string;
  ownerName?: string;
  remark?: string;
  demandIds: number[];
};

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

export function ResourceFormDialog({
  open,
  resource,
  demands,
  /** 从需求汇总页"去配置"跳进来时预填的需求项。 */
  prefillDemand,
  submitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** 传了就是编辑，没传就是新增 */
  resource?: ResourceDetail;
  /** 本活动可关联的需求项（只列需落实的，仅记录的不占台账） */
  demands: ResourceDemand[];
  prefillDemand?: ResourceDemand;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ResourceFormSubmitValues) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {resource ? "修改资源安排" : "新增资源安排"}
          </DialogTitle>
          <DialogDescription>
            资源记录归属活动，不归属环节——一辆接站车可以同时服务多个环节的
            需求。关联需求项是可选的：全场午餐、嘉宾酒店这类活动通用资源不挂
            任何环节。
          </DialogDescription>
        </DialogHeader>
        <ResourceForm
          // 切换编辑对象时整体重挂载，避免上一条的校验错误残留到这一条
          key={resource?.id ?? `new-${prefillDemand?.id ?? ""}`}
          resource={resource}
          demands={demands}
          prefillDemand={prefillDemand}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function ResourceForm({
  resource,
  demands,
  prefillDemand,
  submitting,
  onCancel,
  onSubmit,
}: {
  resource?: ResourceDetail;
  demands: ResourceDemand[];
  prefillDemand?: ResourceDemand;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: ResourceFormSubmitValues) => void;
}) {
  const defaultValues: ResourceFormState = {
    resourceType:
      resource?.resourceType ?? prefillDemand?.resourceType ?? "transport",
    transportScene: resource?.transportScene ?? "",
    name: resource?.name ?? "",
    quantity:
      resource?.quantity === null || resource?.quantity === undefined
        ? (prefillDemand?.estimatedCount?.toString() ?? "")
        : String(resource.quantity),
    startTime: toDateTimeLocalValue(resource?.startTime),
    endTime: toDateTimeLocalValue(resource?.endTime),
    location: resource?.location ?? "",
    vehicleInfo: resource?.vehicleInfo ?? "",
    driverName: resource?.driverName ?? "",
    driverPhone: resource?.driverPhone ?? "",
    // 需求上填了负责人就带过来——新建资源时十有八九是同一个人在跟。
    ownerName: resource?.ownerName ?? prefillDemand?.ownerName ?? "",
    remark: resource?.remark ?? "",
    demandIds:
      resource?.demands.map((demand) => demand.id) ??
      (prefillDemand ? [prefillDemand.id] : []),
  };

  const form = useForm({
    defaultValues,
    validators: { onChange: ResourceFormSchema, onSubmit: ResourceFormSchema },
    onSubmit: ({ value }) => {
      const isTransport = value.resourceType === "transport";
      onSubmit({
        resourceType: value.resourceType,
        // 非用车记录一律清空用车专属字段。用户"先填了车牌又改成物料"时，
        // 表单里那几个框已经隐藏了但值还在——不清的话服务端会打回来。
        transportScene: isTransport
          ? (value.transportScene as TransportScene)
          : null,
        name: value.name,
        quantity: value.quantity === "" ? null : Number(value.quantity),
        startTime: value.startTime ? new Date(value.startTime) : null,
        endTime: value.endTime ? new Date(value.endTime) : null,
        location: value.location || undefined,
        vehicleInfo: isTransport ? value.vehicleInfo || undefined : undefined,
        driverName: isTransport ? value.driverName || undefined : undefined,
        driverPhone: isTransport ? value.driverPhone || undefined : undefined,
        ownerName: value.ownerName || undefined,
        remark: value.remark || undefined,
        demandIds: value.demandIds,
      });
    },
  });

  return (
    <form
      // min-h-0 + flex-1：让 DialogBody 能在 DialogContent 的 flex 列里收缩，
      // 不加的话滚动会落在整个弹窗而不是内容区。
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="resourceType">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  资源类型
                  <RequiredMark />
                </FieldLabel>
                {/* items 必传，否则 SelectValue 渲染的是 "transport" 这种原始值 */}
                <Select
                  items={RESOURCE_TYPE_ITEMS}
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value as ResourceType);
                    field.handleBlur();
                    // 换成非用车时立刻清掉场景，否则那条 refine 会一直红着
                    // 一个用户已经看不见的字段。
                    if (value !== "transport") {
                      form.setFieldValue("transportScene", "");
                    }
                  }}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOURCE_TYPE_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.resourceType}>
            {(resourceType) =>
              resourceType === "transport" ? (
                <form.Field name="transportScene">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>
                        用车场景
                        <RequiredMark />
                      </FieldLabel>
                      <Select
                        items={TRANSPORT_SCENE_ITEMS}
                        value={field.state.value || null}
                        onValueChange={(value) => {
                          field.handleChange(value ?? "");
                          // Select 关闭不触发原生 blur，手动调一次，
                          // 否则选完了错误提示还压着不消失。
                          field.handleBlur();
                        }}
                      >
                        <SelectTrigger
                          id={field.name}
                          aria-invalid={
                            field.state.meta.isTouched &&
                            field.state.meta.errors.length > 0
                          }
                        >
                          <SelectValue placeholder="请选择" />
                        </SelectTrigger>
                        <SelectContent>
                          {TRANSPORT_SCENE_ITEMS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldError
                        errors={
                          field.state.meta.isTouched
                            ? field.state.meta.errors
                            : []
                        }
                      />
                      <FieldDescription>
                        到达接送、离开送站是用车记录的场景，不是独立对象。
                      </FieldDescription>
                    </Field>
                  )}
                </form.Field>
              ) : (
                <div />
              )
            }
          </form.Subscribe>

          <form.Field name="name">
            {(field) => (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={field.name}>
                  资源名称
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="例如：机场接送一号车、嘉宾午餐、迎宾馆双床房"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={
                    field.state.meta.isTouched &&
                    field.state.meta.errors.length > 0
                  }
                />
                {/* 错误必须挂在 isTouched 后面，否则刚打第一个字全表单飘红 */}
                <FieldError
                  errors={
                    field.state.meta.isTouched ? field.state.meta.errors : []
                  }
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="quantity">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>数量 / 规模</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  min={0}
                  placeholder="选填，如 2 辆 / 24 人 / 6 间"
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

          <form.Field name="ownerName">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>负责人</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="选填"
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
                <FieldDescription>
                  住宿填入住到离店的区间；用车、用餐只填开始时间即可。
                </FieldDescription>
              </Field>
            )}
          </form.Field>

          <form.Field name="location">
            {(field) => (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={field.name}>地点 / 集合点</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="例如：晋江国际机场 T2 到达口"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          {/* 用车专属字段：非用车时整块不渲染，服务端也有 CHECK 兜底 */}
          <form.Subscribe selector={(state) => state.values.resourceType}>
            {(resourceType) =>
              resourceType === "transport" ? (
                <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
                  <form.Field name="vehicleInfo">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>车辆信息</FieldLabel>
                        <Input
                          id={field.name}
                          placeholder="选填，如 闽C D2638"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="driverName">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>司机姓名</FieldLabel>
                        <Input
                          id={field.name}
                          placeholder="选填"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="driverPhone">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>司机电话</FieldLabel>
                        <Input
                          id={field.name}
                          placeholder="选填"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </Field>
                    )}
                  </form.Field>
                </div>
              ) : null
            }
          </form.Subscribe>

          {/* 只列**和当前资源类型一致**的需求项。服务端也拦（一条用车需求
              不能由物料记录满足），但如果这里照旧全列出来，用户会先勾上再被
              打回，而打回的理由在这个界面上根本看不出来。
              类型一改，已勾选的跨类型需求要一起清掉。
              Subscribe 嵌在 Field 里面而不是反过来：这样 field 的类型是推出来
              的，不用把 form 当 prop 传出去（那个类型没法写）。 */}
          <form.Field name="demandIds">
            {(field) => (
              <form.Subscribe selector={(state) => state.values.resourceType}>
                {(resourceType) => {
                  const typed = demands.filter(
                    (demand) => demand.resourceType === resourceType,
                  );
                  const allowed = new Set(typed.map((demand) => demand.id));
                  // 类型切换后，上一次勾的跨类型需求要立刻从值里剔掉，否则
                  // 提交时会被服务端打回，而它的复选框已经不在界面上了。
                  const selected = field.state.value.filter((id) =>
                    allowed.has(id),
                  );
                  if (selected.length !== field.state.value.length) {
                    field.handleChange(selected);
                  }

                  return (
                    <Field className="sm:col-span-2">
                      <FieldLabel>关联环节资源需求</FieldLabel>
                      {typed.length === 0 ? (
                        <FieldDescription>
                          本活动还没有「{RESOURCE_TYPE_LABELS[resourceType]}
                          」类型且需落实的环节资源需求。可以先保存这条记录，
                          它会作为活动通用资源存在；等环节声明了需求再回来关联。
                        </FieldDescription>
                      ) : (
                        <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
                          {typed.map((demand) => (
                            <label
                              key={demand.id}
                              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60"
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={selected.includes(demand.id)}
                                onCheckedChange={(next) =>
                                  field.handleChange(
                                    next
                                      ? [...selected, demand.id]
                                      : selected.filter(
                                          (id) => id !== demand.id,
                                        ),
                                  )
                                }
                              />
                              <span>
                                <span className="font-medium">
                                  {demand.segmentName}
                                </span>
                                <span className="text-muted-foreground">
                                  {" · "}
                                  {DEMAND_HANDLING_LABELS[demand.handling]}
                                </span>
                                {demand.description && (
                                  <span className="block text-muted-foreground text-xs">
                                    {demand.description}
                                  </span>
                                )}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      <FieldDescription>
                        一条资源可以服务多条需求（一辆车接多个环节的嘉宾），
                        一条需求也可以拆成多条资源（同一批接送分两辆车）。
                      </FieldDescription>
                    </Field>
                  );
                }}
              </form.Subscribe>
            )}
          </form.Field>

          <form.Field name="remark">
            {(field) => (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={field.name}>备注</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  rows={2}
                  placeholder="可记录路线、候车点、容量、特殊说明"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>
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
