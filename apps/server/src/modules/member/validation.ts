import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import {
  MEMBER_GENDERS,
  MEMBER_ID_TYPES,
  MEMBER_STATUSES,
} from "./schema";

const MemberStatusEnum = z.enum(MEMBER_STATUSES, { error: "状态不正确" });
const MemberGenderEnum = z
  .enum(MEMBER_GENDERS, { error: "性别不正确" })
  .or(z.literal(""))
  .optional()
  .transform((value) => value || null);
const MemberIdTypeEnum = z
  .enum(MEMBER_ID_TYPES, { error: "证件类型不正确" })
  .or(z.literal(""))
  .optional()
  .transform((value) => value || null);
const id = z.number().int().positive();

const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}过长`)
    .optional()
    .transform((value) => value || null);

const optionalPattern = (
  pattern: RegExp,
  message: string,
  max: number,
) =>
  z
    .string()
    .trim()
    .max(max, "联系方式过长")
    .refine((value) => !value || pattern.test(value), message)
    .optional()
    .transform((value) => value || null);

const idNumberRule = (idType?: string | null) => {
  switch (idType) {
    case "身份证":
      return {
        pattern: /(^\d{15}$)|(^\d{17}[\dXx]$)/,
        message: "请输入正确的身份证号码",
      };
    case "护照":
      return {
        pattern: /^[a-zA-Z0-9]{5,17}$/,
        message: "请输入正确的护照号码",
      };
    case "港澳居民来往内地通行证":
      return {
        pattern: /^[HMhm]\d{8}(\d{2})?$/,
        message: "请输入正确的港澳居民来往内地通行证号码",
      };
    case "台湾居民来往大陆通行证":
      return {
        pattern: /^\d{8}$/,
        message: "请输入正确的台湾居民来往大陆通行证号码",
      };
    default:
      return {
        pattern: /^.{1,64}$/,
        message: "请输入证件号码",
      };
  }
};

const validateIdNumber = (
  value: { idType?: string | null; idNumber?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (!value.idNumber) return;

  const rule = idNumberRule(value.idType);
  if (!rule.pattern.test(value.idNumber)) {
    ctx.addIssue({
      code: "custom",
      path: ["idNumber"],
      message: rule.message,
    });
  }
};

const MemberFields = z.object({
  name: required("姓名", 64),
  status: MemberStatusEnum.default("enabled"),
  gender: MemberGenderEnum.optional(),
  countryRegion: optionalText("国别/地区", 64),
  nativePlace: optionalText("籍贯", 128),
  companyPosition: optionalText("企业（社会）职务", 255),
  idType: MemberIdTypeEnum.optional(),
  idNumber: optionalText("证件号码", 64),
  mobile: optionalPattern(/^1\d{10}$/, "请输入正确的手机号", 20),
  phone: optionalPattern(
    /^0\d{2,3}-?\d{7,8}$/,
    "请输入正确的电话号码，如 010-12345678",
    32,
  ),
  email: z
    .string()
    .trim()
    .max(128, "邮箱过长")
    .refine((value) => !value || z.email().safeParse(value).success, "请输入正确的邮箱")
    .optional()
    .transform((value) => value || null),
  language: optionalText("语种", 32),
  remark: optionalText("备注/说明", 2000),
});

export const CreateMemberInput = MemberFields.superRefine(validateIdNumber);
export const UpdateMemberInput = MemberFields.extend({ id }).superRefine(
  validateIdNumber,
);

export const MemberIdInput = z.object({ id });

export const SetMemberStatusInput = z.object({
  id,
  status: MemberStatusEnum,
});

const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

export const ListMembersInput = PageInput.extend({
  name: filter,
  companyPosition: filter,
  status: MemberStatusEnum.optional(),
});
