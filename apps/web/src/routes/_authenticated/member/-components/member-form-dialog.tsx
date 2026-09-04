import {
  CHINA_CODE,
  COUNTRY_REGIONS,
  type CountryRegion,
  citiesOfProvince,
  PROVINCES,
} from "@repo/server/dict";
import { useForm, useStore } from "@tanstack/react-form";
import { LoaderCircleIcon } from "lucide-react";
import { z } from "zod";
import {
  MEMBER_STATUS_LABELS,
  MEMBER_STATUS_VALUES,
} from "#/features/member/utils.ts";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { Textarea } from "#/shared/components/ui/textarea.tsx";
import type { Member, MemberFormValues, OrganizationOption } from "../-queries";
import {
  getIdNumberValidationRule,
  isValidOrganizationId,
  MEMBER_GENDER_VALUES,
  MEMBER_ID_TYPE_LABELS,
  MEMBER_ID_TYPE_VALUES,
} from "../-utils";

const MemberFormSchema = z
  .object({
    name: z.string().trim().min(1, "姓名不能为空").max(64, "姓名过长"),
    status: z.enum(MEMBER_STATUS_VALUES),
    gender: z.enum(MEMBER_GENDER_VALUES).or(z.literal("")).optional(),
    organizationId: z
      .number()
      .nullable()
      .optional()
      .refine(isValidOrganizationId, "所属团体不正确"),
    // 三个字典码。不在这里重写服务端那套交叉规则（外籍不能有籍贯、市必须属于
    // 省）——它们在 UI 上是靠禁用和自动清空做掉的，用户点不出非法组合；真绕过
    // 前端打接口时，validation.ts 的 validateRegion 会拒。
    countryRegionCode: z.string().optional(),
    nativeProvinceCode: z.string().optional(),
    nativeCityCode: z.string().optional(),
    companyPosition: z
      .string()
      .trim()
      .max(255, "企业（社会）职务过长")
      .optional(),
    idType: z.enum(MEMBER_ID_TYPE_VALUES).or(z.literal("")).optional(),
    idNumber: z.string().trim().max(64, "证件号码过长").optional(),
    mobile: z
      .string()
      .trim()
      .max(20, "手机号过长")
      .refine(
        (value) => !value || /^1\d{10}$/.test(value),
        "请输入正确的手机号",
      )
      .optional(),
    phone: z
      .string()
      .trim()
      .max(32, "电话过长")
      .refine(
        (value) => !value || /^0\d{2,3}-?\d{7,8}$/.test(value),
        "请输入正确的电话号码，如 010-12345678",
      )
      .optional(),
    email: z
      .string()
      .trim()
      .max(128, "邮箱过长")
      .refine(
        (value) => !value || z.email().safeParse(value).success,
        "请输入正确的邮箱",
      )
      .optional(),
    language: z.string().trim().max(32, "语种过长").optional(),
    remark: z.string().trim().max(2000, "备注过长").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.idType && !value.idNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["idNumber"],
        message: "请填写证件号码",
      });
      return;
    }

    if (!value.idType && value.idNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["idType"],
        message: "请先选择证件类型",
      });
      return;
    }

    if (!value.idNumber) return;

    const rule = getIdNumberValidationRule(value.idType);
    if (!rule.pattern.test(value.idNumber)) {
      ctx.addIssue({
        code: "custom",
        path: ["idNumber"],
        message: rule.message,
      });
    }
  });

type MemberFormState = z.infer<typeof MemberFormSchema>;

type MemberFormDialogProps = {
  open: boolean;
  member?: Member;
  organizationOptions: OrganizationOption[];
  organizationOptionsLoading: boolean;
  organizationOptionsError?: string;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onRetryOrganizationOptions: () => void;
  onSubmit: (values: MemberFormValues) => void;
};

export function MemberFormDialog({
  open,
  member,
  organizationOptions,
  organizationOptionsLoading,
  organizationOptionsError,
  submitting,
  onOpenChange,
  onRetryOrganizationOptions,
  onSubmit,
}: MemberFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{member ? "修改人员" : "新增人员"}</DialogTitle>
          <DialogDescription>
            带 * 的是必填项，保存后立即生效。
          </DialogDescription>
        </DialogHeader>
        <MemberForm
          key={member?.id ?? "new"}
          member={member}
          organizationOptions={organizationOptions}
          organizationOptionsLoading={organizationOptionsLoading}
          organizationOptionsError={organizationOptionsError}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onRetryOrganizationOptions={onRetryOrganizationOptions}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function MemberForm({
  member,
  organizationOptions,
  organizationOptionsLoading,
  organizationOptionsError,
  submitting,
  onCancel,
  onRetryOrganizationOptions,
  onSubmit,
}: {
  member?: Member;
  organizationOptions: OrganizationOption[];
  organizationOptionsLoading: boolean;
  organizationOptionsError?: string;
  submitting: boolean;
  onCancel: () => void;
  onRetryOrganizationOptions: () => void;
  onSubmit: (values: MemberFormValues) => void;
}) {
  const defaultValues: MemberFormState = {
    name: member?.name ?? "",
    status: member?.status ?? "enabled",
    gender: member?.gender ?? "",
    organizationId: member?.organizationId ?? null,
    // 新增默认"中国"：服务对象绝大多数是中国籍，这个默认值省掉大多数人的一次
    // 选择，而且它是**可见的**（下拉里明摆着写着中国），选错很难不察觉。编辑
    // 存量时不给默认值——那会把"没填"悄悄改写成"中国"。
    countryRegionCode: member ? (member.countryRegionCode ?? "") : CHINA_CODE,
    nativeProvinceCode: member?.nativeProvinceCode ?? "",
    nativeCityCode: member?.nativeCityCode ?? "",
    companyPosition: member?.companyPosition ?? "",
    idType: member?.idType ?? "",
    idNumber: member?.idNumber ?? "",
    mobile: member?.mobile ?? "",
    phone: member?.phone ?? "",
    email: member?.email ?? "",
    language: member?.language ?? "",
    remark: member?.remark ?? "",
  };

  const form = useForm({
    defaultValues,
    validators: {
      onChange: MemberFormSchema,
      onSubmit: MemberFormSchema,
    },
    onSubmit: ({ value }) => onSubmit(value),
  });

  const countryRegionCode = useStore(
    form.store,
    (state) => state.values.countryRegionCode,
  );
  const nativeProvinceCode = useStore(
    form.store,
    (state) => state.values.nativeProvinceCode,
  );

  // 籍贯完全挂在国别下面：非中国籍不适用，国别没填时也不知道适不适用。
  const nativePlaceDisabled = countryRegionCode !== CHINA_CODE;
  const nativePlaceHint = countryRegionCode
    ? nativePlaceDisabled
      ? "外籍无需填写"
      : null
    : "请先选择国别 / 地区";

  // 直辖市和港澳台在字典里就没有市级，这里自然是空数组，市那一栏跟着置灰。
  const cities = citiesOfProvince(nativeProvinceCode);
  const cityItems = Object.fromEntries(
    cities.map((city) => [city.code, city.name]),
  );
  const cityPlaceholder =
    nativeProvinceCode && cities.length === 0 ? "该地区无市级" : "请选择城市";
  const selectableOrganizations = [...organizationOptions];
  if (
    member?.organizationId &&
    member.organizationName &&
    !selectableOrganizations.some((item) => item.id === member.organizationId)
  ) {
    // 编辑弹窗可能先命中 member 详情缓存、团体选项仍在加载。保留当前值，避免
    // 下拉短暂显示一个没有标签的裸 id；服务端外键保证已绑定团体不可能被删除。
    selectableOrganizations.unshift({
      id: member.organizationId,
      name: member.organizationName,
    });
  }
  const organizationSelectItems = [
    { value: null, label: "不加入团体" },
    ...selectableOrganizations.map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <DialogBody className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  姓名
                  <RequiredMark />
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="请输入姓名"
                  value={field.state.value ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={hasError(field)}
                />
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="gender">
            {(field) => (
              <Field>
                <FieldLabel>性别</FieldLabel>
                <Select
                  items={{ 男: "男", 女: "女" }}
                  value={field.state.value || null}
                  onValueChange={(value) => {
                    field.handleChange(value ?? "");
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-invalid={hasError(field)}
                  >
                    <SelectValue placeholder="请选择性别" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>不填写</SelectItem>
                    {MEMBER_GENDER_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="status">
            {(field) => (
              <Field>
                <FieldLabel>启用状态</FieldLabel>
                <Select
                  items={MEMBER_STATUS_LABELS}
                  value={field.state.value}
                  onValueChange={(value) => {
                    if (value)
                      field.handleChange(value as MemberFormState["status"]);
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMBER_STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {MEMBER_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="organizationId">
            {(field) => (
              <Field data-invalid={Boolean(organizationOptionsError)}>
                <FieldLabel>所属团体</FieldLabel>
                <Select
                  items={organizationSelectItems}
                  value={field.state.value ?? null}
                  disabled={
                    submitting ||
                    organizationOptionsLoading ||
                    Boolean(organizationOptionsError)
                  }
                  onValueChange={(value) => {
                    field.handleChange(value == null ? null : Number(value));
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-invalid={Boolean(organizationOptionsError)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {organizationSelectItems.map((item) => (
                        <SelectItem
                          key={item.value ?? "unassigned"}
                          value={item.value}
                        >
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {organizationOptionsLoading && (
                  <FieldDescription>团体选项加载中…</FieldDescription>
                )}
                {organizationOptionsError && (
                  <FieldError>
                    <span>{organizationOptionsError}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="link"
                      onClick={onRetryOrganizationOptions}
                    >
                      重试
                    </Button>
                  </FieldError>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field name="countryRegionCode">
            {(field) => (
              <Field className="sm:col-span-2">
                <FieldLabel>国别 / 地区</FieldLabel>
                <CountryRegionCombobox
                  value={field.state.value ?? ""}
                  invalid={hasError(field)}
                  onChange={(code) => {
                    field.handleChange(code);
                    field.handleBlur();
                    // 切成外籍（或清空国别）时立刻清掉已选的省市。留着的话屏幕上会
                    // 同时出现灰掉的"浙江省 杭州市"和"外籍无需填写"，自相矛盾。
                    if (code !== CHINA_CODE) {
                      form.setFieldValue("nativeProvinceCode", "");
                      form.setFieldValue("nativeCityCode", "");
                    }
                  }}
                />
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>

          {/* 籍贯占满一行：标签下面是省、市两个下拉，跟设计稿一致。 */}
          <Field className="sm:col-span-2">
            <FieldLabel>籍贯</FieldLabel>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="nativeProvinceCode">
                {(field) => (
                  <Select
                    items={PROVINCE_ITEMS}
                    value={field.state.value || null}
                    disabled={nativePlaceDisabled}
                    onValueChange={(value) => {
                      field.handleChange(value ?? "");
                      field.handleBlur();
                      // 换省必须清市，否则会留下"浙江省 + 泉州市"这种组合，
                      // 服务端会拒（validateRegion 的"市不属于该省份"）。
                      form.setFieldValue("nativeCityCode", "");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="请选择省份" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>不填写</SelectItem>
                      {PROVINCES.map((province) => (
                        <SelectItem key={province.code} value={province.code}>
                          {province.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </form.Field>

              <form.Field name="nativeCityCode">
                {(field) => (
                  <Select
                    items={cityItems}
                    value={field.state.value || null}
                    disabled={nativePlaceDisabled || cities.length === 0}
                    onValueChange={(value) => {
                      field.handleChange(value ?? "");
                      field.handleBlur();
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={cityPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>不填写</SelectItem>
                      {cities.map((city) => (
                        <SelectItem key={city.code} value={city.code}>
                          {city.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </form.Field>
            </div>
            {nativePlaceHint && (
              <FieldDescription>{nativePlaceHint}</FieldDescription>
            )}
          </Field>

          <form.Field name="companyPosition">
            {(field) => (
              <TextField
                field={field}
                label="企业（社会）职务"
                placeholder="请输入企业（社会）职务"
                className="sm:col-span-2"
              />
            )}
          </form.Field>

          <form.Field name="idType">
            {(field) => (
              <Field>
                <FieldLabel>证件类型</FieldLabel>
                <Select
                  items={MEMBER_ID_TYPE_LABELS}
                  value={field.state.value || null}
                  onValueChange={(value) => {
                    field.handleChange(value ?? "");
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-invalid={hasError(field)}
                  >
                    <SelectValue placeholder="请选择证件类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>不填写</SelectItem>
                    {MEMBER_ID_TYPE_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {MEMBER_ID_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="idNumber">
            {(field) => (
              <TextField
                field={field}
                label="证件号码"
                placeholder="请输入证件号码"
              />
            )}
          </form.Field>

          <form.Field name="mobile">
            {(field) => (
              <TextField
                field={field}
                label="手机号"
                placeholder="请输入手机号"
              />
            )}
          </form.Field>

          <form.Field name="phone">
            {(field) => (
              <TextField
                field={field}
                label="电话"
                placeholder="请输入电话，如 010-12345678"
              />
            )}
          </form.Field>

          <form.Field name="email">
            {(field) => (
              <TextField field={field} label="邮箱" placeholder="请输入邮箱" />
            )}
          </form.Field>

          <form.Field name="language">
            {(field) => (
              <TextField field={field} label="语种" placeholder="请输入语种" />
            )}
          </form.Field>
        </div>

        <form.Field name="remark">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>备注 / 说明</FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                rows={4}
                placeholder="请输入备注 / 说明"
                value={field.state.value ?? ""}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={hasError(field)}
              />
              <FieldError errors={fieldErrors(field)} />
            </Field>
          )}
        </form.Field>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <LoaderCircleIcon className="animate-spin" />}
          保存
        </Button>
      </DialogFooter>
    </form>
  );
}

const PROVINCE_ITEMS = Object.fromEntries(
  PROVINCES.map((province) => [province.code, province.name]),
);

/**
 * 国别 / 地区选择器。
 *
 * 246 项的列表用原生下拉翻不动，必须能搜。搜索**同时匹配中文名和 alpha-2 码**：
 * 输 `US` 和输"美国"都能定位到美国，这么长的列表里码往往是更快的输入路径，而且
 * 它顺带让人看见这个字段是有标准的。码只用于显示和搜索——落库的是码本身，显示用
 * 的名字由服务端查同一份字典派生。
 *
 * 清空走输入框里的 ✕（`showClear`），不是列表里的"不填写"项——后者在这个组件上
 * 根本选不中，见 ui/combobox.tsx 里 ComboboxClear 那段注释。所以这个下拉的清空
 * 方式跟同一张表单里的性别、证件类型不一样，是组件差异逼出来的。
 */
function CountryRegionCombobox({
  value,
  invalid,
  onChange,
}: {
  value: string;
  invalid: boolean;
  onChange: (code: string) => void;
}) {
  const selected = value
    ? (COUNTRY_REGIONS.find((item) => item.code === value) ?? null)
    : null;

  return (
    <Combobox
      items={COUNTRY_REGIONS}
      value={selected}
      onValueChange={(item: CountryRegion | null) => onChange(item?.code ?? "")}
      itemToStringLabel={(item: CountryRegion) => item.name}
      filter={(item: CountryRegion, query: string) => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return true;
        return (
          item.name.includes(query.trim()) ||
          item.code.toLowerCase().includes(keyword)
        );
      }}
    >
      <ComboboxInput
        placeholder="请选择国别 / 地区"
        aria-invalid={invalid}
        className="w-full"
        showClear
      />
      <ComboboxContent>
        <ComboboxEmpty>没有匹配的国别 / 地区</ComboboxEmpty>
        <ComboboxList>
          {(item: CountryRegion) => (
            <ComboboxItem key={item.code} value={item}>
              <span className="w-6 shrink-0 text-muted-foreground text-xs">
                {item.code}
              </span>
              {item.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function TextField({
  field,
  label,
  placeholder,
  className,
}: {
  field: {
    name: string;
    state: {
      value: string | undefined;
      meta: {
        isTouched: boolean;
        errors: Array<{ message?: string } | undefined>;
      };
    };
    handleBlur: () => void;
    handleChange: (value: string) => void;
  };
  label: string;
  placeholder: string;
  className?: string;
}) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        placeholder={placeholder}
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={hasError(field)}
      />
      <FieldError errors={fieldErrors(field)} />
    </Field>
  );
}

function hasError(field: {
  state: {
    meta: {
      isTouched: boolean;
      errors: Array<{ message?: string } | undefined>;
    };
  };
}) {
  return field.state.meta.isTouched && field.state.meta.errors.length > 0;
}

function fieldErrors(field: {
  state: {
    meta: {
      isTouched: boolean;
      errors: Array<{ message?: string } | undefined>;
    };
  };
}) {
  return field.state.meta.isTouched ? field.state.meta.errors : [];
}

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}
