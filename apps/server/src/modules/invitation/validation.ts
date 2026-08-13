import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import {
  INVITATION_ISSUERS,
  INVITATION_TEMPLATE_STATUSES,
} from "./schema";

const IssuerEnum = z.enum(INVITATION_ISSUERS, { error: "发函主体不正确" });
const TemplateStatusEnum = z.enum(INVITATION_TEMPLATE_STATUSES, {
  error: "状态不正确",
});
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

const phone = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^[\d\-+()（）\s]{5,20}$/, `请输入正确的${label}`);

/** 富文本存的是 Tiptap 输出的 HTML，去标签后判断是否真的有内容。 */
const richText = (label: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) => value.replace(/<[^>]+>/g, "").trim().length > 0,
      `${label}不能为空`,
    );

const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

const InvitationTemplateFields = z.object({
  name: required("模板名称", 255),
  issuer: IssuerEnum,
  applicableDesc: optionalText("适用说明", 255),
  status: TemplateStatusEnum.default("enabled"),
  bodyContent: richText("正文内容"),
  annexTitle: optionalText("附则标题", 255),
  annexContent: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || null),
  contactPerson: required("联系人", 64),
  contactPhone: phone("联系电话"),
  signOff: required("落款", 128),
});

export const CreateInvitationTemplateInput = InvitationTemplateFields;
export const UpdateInvitationTemplateInput = InvitationTemplateFields.extend({
  id,
});
export const InvitationTemplateIdInput = z.object({ id });

export const SetInvitationTemplateStatusInput = z.object({
  id,
  status: TemplateStatusEnum,
});

export const ListInvitationTemplatesInput = PageInput.extend({
  name: filter,
  issuer: IssuerEnum.optional(),
  status: TemplateStatusEnum.optional(),
});

// ---------------------------------------------------------------------------
// 生成批次
// ---------------------------------------------------------------------------

/**
 * 只收 templateId + 允许覆盖的四个字段 + 目标人员 id 列表。
 *
 * 正文/落款/受邀人快照**不**由客户端传入——服务端会按 templateId 现查模板、
 * 按 memberId 现查人员，自己拼快照。旧版是模板查了但结果丢弃，正文等内容
 * 整段信任客户端传入，这里把这个信任边界收回来。
 */
export const CreateInvitationBatchInput = z.object({
  projectId: id.optional(),
  activityId: id.optional(),
  templateId: id,
  contactPerson: required("联系人", 64).optional(),
  contactPhone: phone("联系电话").optional(),
  signOff: required("落款", 128).optional(),
  issueDate: z.iso.date({ error: "请选择正确的发函日期" }),
  targets: z
    .array(id)
    .min(1, "请选择邀请对象")
    .max(500, "单次最多邀请 500 人")
    .transform((value) => [...new Set(value)]),
});

export const ListInvitationBatchesInput = PageInput.extend({
  activityId: id.optional(),
  templateName: filter,
  issuer: IssuerEnum.optional(),
  batchNo: filter,
  recipientName: filter,
});

export const InvitationBatchIdInput = z.object({ id });
