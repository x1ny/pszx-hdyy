import {
  lineLabel,
  SEGMENT_TYPE_LABELS,
  SEGMENT_TYPE_VALUES,
} from "#/features/agenda/labels";
import type { AgendaLine } from "#/features/agenda/queries";
import {
  Field,
  FieldDescription,
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
import type { BaseDraft } from "../-draft";
import { SectionCard } from "./section-card";

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

/**
 * 环节基础信息。字段和旧的表单弹窗完全一致，两处变化：
 *
 * - 两个 enabled 复选框移到了各自区块的标题栏（见 SectionCard）。
 * - 地点仍然只是一个文本框：原型画了「自定义输入 / 地图选点」两个 tab，本期
 *   不做地图选点——坐标现在没有任何下游在消费（H5 行程页还是静态常量），而
 *   引地图 SDK 要连带处理 key 管理、加载失败降级和坐标系（高德 GCJ-02 和 GPS
 *   差几百米，存的时候不记清楚用的哪套，将来必然错）。
 */
export function BasicSection({
  base,
  lines,
  activityRange,
  errors,
  onChange,
}: {
  base: BaseDraft;
  lines: AgendaLine[];
  activityRange: { start: string; end: string } | null;
  errors: Partial<Record<keyof BaseDraft, string>>;
  onChange: <K extends keyof BaseDraft>(field: K, value: BaseDraft[K]) => void;
}) {
  const mainLine = lines.find((line) => line.lineType === "main");
  const parallelLines = lines.filter((line) => line.lineType === "parallel");

  const lineItems = [
    { value: "main", label: mainLine ? lineLabel(mainLine) : "主线" },
    ...parallelLines.map((line) => ({
      value: String(line.id),
      label: lineLabel(line),
    })),
    { value: "new", label: "＋ 新建并行线…" },
  ];

  const outsideRange =
    activityRange !== null &&
    ((base.startTime &&
      new Date(base.startTime) < new Date(activityRange.start)) ||
      (base.endTime && new Date(base.endTime) > new Date(activityRange.end)));

  return (
    <SectionCard
      id="section-base"
      title="环节基本信息"
      description="同一条议程线上的环节时间不能重叠；需要同时进行的环节请放到并行线。"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="segment-name">
            环节名称
            <RequiredMark />
          </FieldLabel>
          <Input
            id="segment-name"
            placeholder="例如：开幕式、主题演讲"
            value={base.name}
            aria-invalid={!!errors.name}
            onChange={(event) => onChange("name", event.target.value)}
          />
          {errors.name ? (
            <p className="text-destructive text-sm">{errors.name}</p>
          ) : null}
        </Field>

        <Field>
          <FieldLabel>
            环节类型
            <RequiredMark />
          </FieldLabel>
          <Select
            items={SEGMENT_TYPE_LABELS}
            value={base.segmentType}
            // Base UI 的 Select 允许清空（回 null），但环节类型没有"未选择"
            // 这个状态，忽略它比断言掉安全。
            onValueChange={(value) => {
              if (value) onChange("segmentType", value);
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

        <Field>
          <FieldLabel>
            议程线
            <RequiredMark />
          </FieldLabel>
          <Select
            items={lineItems}
            value={base.lineKey}
            onValueChange={(value) => onChange("lineKey", String(value))}
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
            主线只能有一条，画在时间轴第一层。
          </FieldDescription>
        </Field>

        {base.lineKey === "new" ? (
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="new-line-name">
              新并行线名称
              <RequiredMark />
            </FieldLabel>
            <Input
              id="new-line-name"
              placeholder="例如：分论坛 A"
              value={base.newLineName}
              aria-invalid={!!errors.newLineName}
              onChange={(event) => onChange("newLineName", event.target.value)}
            />
            <FieldDescription>
              保存时会先创建这条并行线，再把环节放上去。
            </FieldDescription>
            {errors.newLineName ? (
              <p className="text-destructive text-sm">{errors.newLineName}</p>
            ) : null}
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor="segment-start">
            开始时间
            <RequiredMark />
          </FieldLabel>
          <Input
            id="segment-start"
            type="datetime-local"
            value={base.startTime}
            aria-invalid={!!errors.startTime}
            onChange={(event) => onChange("startTime", event.target.value)}
          />
          {errors.startTime ? (
            <p className="text-destructive text-sm">{errors.startTime}</p>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="segment-end">
            结束时间
            <RequiredMark />
          </FieldLabel>
          <Input
            id="segment-end"
            type="datetime-local"
            value={base.endTime}
            aria-invalid={!!errors.endTime}
            onChange={(event) => onChange("endTime", event.target.value)}
          />
          {errors.endTime ? (
            <p className="text-destructive text-sm">{errors.endTime}</p>
          ) : null}
        </Field>

        {/* 超出活动时间范围只提示不阻断——C-016：本期业务冲突允许保存但提示 */}
        {outsideRange ? (
          <p className="text-warning-foreground text-xs sm:col-span-2">
            提示：环节时间超出了活动的起止范围，仍可保存，但请确认不是填错了。
          </p>
        ) : null}

        <Field>
          <FieldLabel htmlFor="segment-location">地点 / 区域</FieldLabel>
          <Input
            id="segment-location"
            placeholder="例如：主会场、6号馆 A区"
            value={base.locationText}
            onChange={(event) => onChange("locationText", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="segment-owner">环节负责人</FieldLabel>
          <Input
            id="segment-owner"
            placeholder="填写姓名"
            value={base.ownerName}
            onChange={(event) => onChange("ownerName", event.target.value)}
          />
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="segment-description">环节说明</FieldLabel>
          <Textarea
            id="segment-description"
            rows={3}
            placeholder="补充说明，例如流程要点、注意事项"
            value={base.description}
            onChange={(event) => onChange("description", event.target.value)}
          />
        </Field>
      </div>
    </SectionCard>
  );
}
