import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import { INVITATION_TEMPLATE_STATUSES } from "./schema";

const TemplateStatusEnum = z.enum(INVITATION_TEMPLATE_STATUSES, {
  error: "状态不正确",
});

const id = z.number().int().positive();
const fileId = z.uuid({ error: "文件不正确" });

const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}过长`)
    .optional()
    .transform((value) => value || null);

const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

/**
 * 表单只剩三个字段 + 一个文件。
 *
 * 没有 bodyContent / signOff / contactPerson 这些——**版式和内容都在 docx 里**，
 * 变量清单由服务端解析文件得出（客户端传什么都不作数），变量取值则属于生成
 * 批次，不属于模板。
 */
const InvitationTemplateFields = z.object({
  name: required("模板名称", 255),
  applicableDesc: optionalText("适用说明", 255),
  status: TemplateStatusEnum.default("enabled"),
  templateFileId: fileId,
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
  status: TemplateStatusEnum.optional(),
});

/**
 * 预览吃的是 fileId 而不是 templateId：模板页保存前就要能看，不然用户必须先
 * 保存一个自己都没看过的模板。
 */
export const InspectInvitationTemplateInput = z.object({
  templateFileId: fileId,
});

/**
 * 预览。不传 `variables` 就用样例值（模板页的场景：还没人填过任何东西）；
 * 传了就用真实值补上——生成页在点「开始生成」之前，看到的应该就是即将生成
 * 出来的那份东西，而不是一份填着【联系人】占位文字的样子货。
 */
export const PreviewInvitationTemplateInput = z.object({
  templateFileId: fileId,
  variables: z.record(z.string(), z.string()).optional(),
  recipientName: z.string().trim().max(64).optional(),
  issueDate: z.iso.date().optional(),
});

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

/**
 * 变量取值：变量名 → 用户输入。
 *
 * 值允许为空字符串（模板里某个变量这次确实不需要填），但**不允许缺键**——
 * 缺哪个键由服务端按模板的变量清单判定并报错，见 routes.ts。
 */
const VariableValues = z
  .record(z.string(), z.string().trim().max(500, "变量取值过长"))
  .default({});

/**
 * 上限 200：个人模式限制 200 人，团体模式限制 200 个团体。两种模式最终都
 * 生成不超过 200 份文件，下载和生成保持同一口径。
 */
const recipientIds = z
  .array(id)
  .min(1, "请选择邀请对象")
  .max(200, "单次最多 200 个邀请对象，请分批生成")
  .transform((value) => [...new Set(value)]);

const InvitationBatchCommonFields = {
  activityId: id,
  templateId: id,
  issueDate: z.iso.date({ error: "请选择正确的发函日期" }),
  variables: VariableValues,
};

/** 个人/团体是互斥入参，请求只携带当前模式对应的编号字段。 */
export const CreateInvitationBatchInput = z.discriminatedUnion(
  "recipientType",
  [
    z.object({
      ...InvitationBatchCommonFields,
      recipientType: z.literal("member"),
      memberIds: recipientIds,
    }),
    z.object({
      ...InvitationBatchCommonFields,
      recipientType: z.literal("organization"),
      organizationIds: recipientIds,
    }),
  ],
);

/** 生成页带出该模板上一次填的值做默认。 */
export const LastVariableValuesInput = z.object({ templateId: id });

/** 生成记录永远是「当前活动的批次列表」，所以 activityId 必填。 */
export const ListInvitationBatchesInput = PageInput.extend({
  activityId: id,
  templateName: filter,
  batchNo: filter,
  recipientName: filter,
});

export const InvitationBatchIdInput = z.object({ id });

// ---------------------------------------------------------------------------
// 下载
// ---------------------------------------------------------------------------

export const DownloadInvitationRecordInput = z.object({ recordId: id });

export const DownloadInvitationBatchInput = z.object({
  batchId: id,
  /** 不传表示整批。传了就是批次内的子集（列表页勾选下载）。 */
  memberIds: z
    .array(id)
    .max(200, "单次最多下载 200 份，请分批下载")
    .optional()
    .transform((value) => (value?.length ? [...new Set(value)] : undefined)),
  organizationIds: z
    .array(id)
    .max(200, "单次最多下载 200 份，请分批下载")
    .optional()
    .transform((value) => (value?.length ? [...new Set(value)] : undefined)),
});
