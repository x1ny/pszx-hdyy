import {
  Field,
  FieldGroup,
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
import { SEGMENT_MEMBER_ROLE_VALUES } from "./relation-queries";

/**
 * 活动人员关系字段的表单片段。
 *
 * 来源、分组仍保留在 `RelationFormValues` 和 `toRelationInput` 中，以兼容现有
 * 接口和编辑时的原值回传；当前活动人员新增/编辑界面暂不展示这两个字段。
 * 这里集中维护负责人、负责人电话和备注的布局，避免三个弹窗的字段顺序和间距
 * 各自漂移。
 *
 * ── 间距为什么由这个组件自己兜 ──────────────────────────────────
 *
 * ui/field.tsx 把纵向间距分成两层职责：`Field` 的 vertical 变体是
 * `flex flex-col gap-3`，只管**一个字段内部**标签到控件的 12px；字段与字段
 * 之间的间距归**容器**，也就是 `FieldGroup`（`flex w-full flex-col gap-*`）。
 *
 * 这里踩过一次坑，值得写下来：这个组件一开始返回的是裸 fragment，把容器责任
 * 留给了调用方。结果同一个组件在两处渲染出两种间距——在手动录入弹窗里它被塞进
 * `<form class="grid gap-4">`，有 16px；在"编辑关系"弹窗里它的父节点是
 * `DialogBody`，而 DialogBody 是 `px-6 py-6` 的**纯滚动视口**，
 * `display:block` 且没有 gap，于是字段之间塌成 0，标签直接贴在上一个输入框上。
 *
 * 根因不是少写了一个 margin，是**组件的正确性依赖了一条没写下来的父级约定**。
 * 所以修法不是给调用方补 class（下次还会忘），而是让组件自带 FieldGroup：
 * 自包含之后它塞进任何父容器都长一样，嵌套进另一个 FieldGroup 也只是成为
 * 其中一个子项，间距依然均匀。
 *
 * 规矩：**任何渲染多个 Field 的组件，都必须自己套 FieldGroup，不许返回裸
 * fragment。**
 *
 * gap 取 5（20px）而不是 FieldGroup 默认的 7，是为了跟全量人员库那个完整表单
 * （member-form-dialog.tsx 的 `DialogBody className="flex flex-col gap-5"`）
 * 的节奏一致——两个表单在同一个系统里不该疏密不一。
 */
export type RelationFormValues = {
  source: string;
  groupName: string;
  ownerName: string;
  remark: string;
};

export const emptyRelationForm: RelationFormValues = {
  source: "",
  groupName: "",
  ownerName: "",
  remark: "",
};

/** 表单值 → 接口入参：空串转 undefined，后端那边空串和未填是一回事。 */
export const toRelationInput = (value: RelationFormValues) => ({
  source: value.source || undefined,
  groupName: value.groupName || undefined,
  ownerName: value.ownerName || undefined,
  remark: value.remark || undefined,
});

export function RelationFields({
  value,
  onChange,
  idPrefix = "rel",
  ownerPhone,
}: {
  value: RelationFormValues;
  onChange: (next: RelationFormValues) => void;
  /** 同一个页面可能同时挂着两个这样的表单（新增弹窗 + 编辑弹窗），id 得错开。 */
  idPrefix?: string;
  /**
   * 负责人电话，选填，只有活动层有——跟下面 `SegmentRoleField` 是同一个道理，
   * 单独一个 prop 而不是塞进 `RelationFormValues`：那个类型三层共用，
   * activity_member 之外没有 owner_phone 这一列（见 schema.ts 的注释），
   * 环节层将来复用这个组件时不传这个 prop，字段就不会出现，不用改这个文件。
   *
   * 传了就跟"负责人"并排渲染成两列，保持活动人员表单的紧凑排版。
   */
  ownerPhone?: { value: string; onChange: (next: string) => void };
}) {
  const set = (patch: Partial<RelationFormValues>) =>
    onChange({ ...value, ...patch });

  return (
    <FieldGroup className="gap-5">
      <div className={ownerPhone ? "grid grid-cols-2 gap-4" : undefined}>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-owner`}>负责人</FieldLabel>
          <Input
            id={`${idPrefix}-owner`}
            placeholder="如：王运营"
            value={value.ownerName}
            onChange={(event) => set({ ownerName: event.target.value })}
          />
        </Field>
        {ownerPhone && (
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-owner-phone`}>
              负责人电话
            </FieldLabel>
            <Input
              id={`${idPrefix}-owner-phone`}
              placeholder="如：13800000000 或 010-12345678"
              value={ownerPhone.value}
              onChange={(event) => ownerPhone.onChange(event.target.value)}
            />
          </Field>
        )}
      </div>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-remark`}>备注</FieldLabel>
        <Textarea
          id={`${idPrefix}-remark`}
          rows={3}
          value={value.remark}
          onChange={(event) => set({ remark: event.target.value })}
        />
      </Field>
    </FieldGroup>
  );
}

/** 环节身份。只有环节层有，单独一个组件而不是塞进 RelationFields 的可选项。 */
export function SegmentRoleField({
  value,
  onChange,
  id = "segment-role",
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>环节身份</FieldLabel>
      <Select
        items={SEGMENT_MEMBER_ROLE_VALUES.map((role) => ({
          value: role,
          label: role,
        }))}
        value={value || null}
        onValueChange={(next) => onChange(String(next ?? ""))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="未设置" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>未设置</SelectItem>
          {SEGMENT_MEMBER_ROLE_VALUES.map((role) => (
            <SelectItem key={role} value={role}>
              {role}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
