import { useEffect, useState } from "react";
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
import type { NewMemberFields } from "./relation-queries";

/**
 * 从关系入口手动录入一个人。
 *
 * 字段是全量人员库那张表的**子集**，不是全套。理由和后端的 NewMemberFields
 * 一样：关系入口的场景是"名单上多了个人，先加进来"，籍贯、语种、邮箱这些留到
 * 全量人员库补全更合适；导入模板的必填项也只有姓名（文档 8.1.2 校验规则第 1
 * 条），这里跟它对齐。所以底部那句提示不是客套，是在告诉运营剩下的字段去哪补。
 *
 * 校验交给后端：同一套 zod 规则（手机号/证件号正则、证件类型+号码唯一）已经在
 * validation.ts 里了，前端再写一遍就是第二个真相源。失败信息由调用方 toast。
 */
export type QuickCreateValues = {
  member: NewMemberFields;
  segmentRole?: string;
  source?: string;
  groupName?: string;
  ownerName?: string;
  remark?: string;
};

// 不含"未填写"项：清空走 Select 的 null 值（`<SelectItem value={null}>`），
// 跟 member-form-dialog 的写法一致。用空串当"未填"会让 value="" 和
// placeholder 两套机制打架。
const GENDERS = [
  { value: "男", label: "男" },
  { value: "女", label: "女" },
] as const;

const ID_TYPES = [
  { value: "身份证", label: "身份证" },
  { value: "护照", label: "护照" },
  { value: "港澳居民来往内地通行证", label: "港澳居民来往内地通行证" },
  { value: "台湾居民来往大陆通行证", label: "台湾居民来往大陆通行证" },
  { value: "其他", label: "其他" },
] as const;

type FormState = {
  name: string;
  gender: string;
  companyPosition: string;
  idType: string;
  idNumber: string;
  mobile: string;
};

const empty: FormState = {
  name: "",
  gender: "",
  companyPosition: "",
  idType: "",
  idNumber: "",
  mobile: "",
};

export function MemberQuickCreateDialog({
  open,
  title,
  description,
  submitting,
  extraFields,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  submitting?: boolean;
  /** 当前层的关系字段（来源/分组/负责人/环节身份），由调用方渲染。 */
  extraFields?: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  onSubmit: (member: NewMemberFields) => void;
}) {
  const [form, setForm] = useState<FormState>(empty);

  useEffect(() => {
    if (open) setForm(empty);
  }, [open]);

  const set = (patch: Partial<FormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <DialogBody>
          <form
            id="quick-create-member"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit({
                name: form.name.trim(),
                gender: (form.gender || undefined) as NewMemberFields["gender"],
                companyPosition: form.companyPosition.trim() || undefined,
                idType: (form.idType || undefined) as NewMemberFields["idType"],
                idNumber: form.idNumber.trim() || undefined,
                mobile: form.mobile.trim() || undefined,
              });
            }}
          >
            {/* 字段列表一律套 FieldGroup，理由见 relation-fields.tsx 顶部那段
                「间距为什么由组件自己兜」。gap-5 对齐 member-form-dialog 的
                节奏；extraFields 传进来的也自带 FieldGroup，嵌套后仍然均匀。 */}
            <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="qc-name">
                姓名 <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="qc-name"
                required
                value={form.name}
                onChange={(event) => set({ name: event.target.value })}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="qc-gender">性别</FieldLabel>
                <Select
                  items={GENDERS}
                  value={form.gender || null}
                  onValueChange={(value) => set({ gender: String(value ?? "") })}
                >
                  <SelectTrigger id="qc-gender" className="w-full">
                    <SelectValue placeholder="未填写" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>未填写</SelectItem>
                    {GENDERS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="qc-mobile">手机号码</FieldLabel>
                <Input
                  id="qc-mobile"
                  inputMode="numeric"
                  value={form.mobile}
                  onChange={(event) => set({ mobile: event.target.value })}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="qc-position">企业（社会）职务</FieldLabel>
              <Input
                id="qc-position"
                value={form.companyPosition}
                onChange={(event) =>
                  set({ companyPosition: event.target.value })
                }
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="qc-idtype">证件类型</FieldLabel>
                <Select
                  items={ID_TYPES}
                  value={form.idType || null}
                  onValueChange={(value) => set({ idType: String(value ?? "") })}
                >
                  <SelectTrigger id="qc-idtype" className="w-full">
                    <SelectValue placeholder="未填写" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>未填写</SelectItem>
                    {ID_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="qc-idnumber">证件号码</FieldLabel>
                <Input
                  id="qc-idnumber"
                  value={form.idNumber}
                  onChange={(event) => set({ idNumber: event.target.value })}
                />
              </Field>
            </div>

            {extraFields}

            <p className="text-muted-foreground text-xs">
              保存后会同时写入全量人员库。籍贯、国别、邮箱、语种等其余信息请到「人员管理
              / 全量人员库」补全。
            </p>
            </FieldGroup>
          </form>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="submit"
            form="quick-create-member"
            disabled={submitting || !form.name.trim()}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
