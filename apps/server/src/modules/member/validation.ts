import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import {
  MEMBER_GENDERS,
  MEMBER_ID_TYPES,
  MEMBER_STATUSES,
  SEGMENT_MEMBER_ROLES,
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

// ---------------------------------------------------------------------------
// 人员关系（项目 / 活动 / 环节）
// ---------------------------------------------------------------------------

/**
 * 一次批量拉人的上限。
 *
 * 不是防御性的魔数：ladder 的每层都是 2 次往返、批量大小无关，真正受影响的是
 * 单个事务的持有时长和一次请求的 body 大小。200 人一批已经远超"选人抽屉勾一屏"
 * 的实际用量，导入走的是另一条批次化的路径（本期还没建），不受这条限制。
 */
const memberIds = z
  .array(id)
  .min(1, "请先选择人员")
  .max(200, "一次最多添加 200 人");

/** 运营手填的关系字段，三层共用。 */
const relationFields = {
  source: optionalText("来源", 128),
  groupName: optionalText("分组", 128),
  ownerName: optionalText("负责人", 64),
  remark: optionalText("备注", 2000),
};

/**
 * 入口标记。originType 整体是系统生成的（R-003），但"这批人是从哪个选择器进来
 * 的"只有客户端知道，所以由客户端传一个**收窄过的**子集，服务端再补齐剩下的
 * 值（backfill_from_* 永远由 ladder 自己写，客户端传不了）。
 */
const ActivityEntryOrigin = z
  .enum(["manual", "project_assign", "registration"], { error: "录入渠道不正确" })
  .default("manual");

const SegmentEntryOrigin = z
  .enum(["manual", "segment_reference"], { error: "录入渠道不正确" })
  .default("manual");

const SegmentRoleEnum = z
  .enum(SEGMENT_MEMBER_ROLES, { error: "环节身份不正确" })
  .or(z.literal(""))
  .optional()
  .transform((value) => value || null);

// --- 项目人员 ---

export const ListProjectMembersInput = PageInput.extend({
  projectId: id,
  name: filter,
  companyPosition: filter,
});

export const AddProjectMembersInput = z.object({
  projectId: id,
  memberIds,
  remark: relationFields.remark,
});

export const UpdateProjectMemberInput = z.object({
  id,
  remark: relationFields.remark,
});

export const RelationIdInput = z.object({ id });

// --- 活动人员 ---

export const ListActivityMembersInput = PageInput.extend({
  activityId: id,
  name: filter,
  companyPosition: filter,
  groupName: filter,
});

export const AddActivityMembersInput = z.object({
  activityId: id,
  memberIds,
  originType: ActivityEntryOrigin,
  // 批量套用同一组关系字段——原型 activity-members.html 的"新增活动人员"弹窗
  // 就是一组表单配一次多选，不是每人一行。环节层才需要逐行填，见下面。
  ...relationFields,
});

export const UpdateActivityMemberInput = z.object({
  id,
  ...relationFields,
});

/**
 * 移除活动人员。
 *
 * BR-DEV-029："活动人员允许一键解除当前活动下关联内容，但需展示影响清单并
 * 二次确认，确认后不支持复原。"——`cascade` 就是那次二次确认的结果。默认 false，
 * 有下游关系时直接拒绝；前端拿到拒绝后调 /impact 查清单，用户确认再带
 * cascade: true 重来一次。把"看清单"和"真删"分成两次请求，是为了让清单一定
 * 是用户看过的那份，而不是前端自己拼一句提示文案。
 */
export const RemoveActivityMemberInput = z.object({
  id,
  cascade: z.boolean().default(false),
});

// --- 环节人员 ---

export const ListSegmentMembersInput = PageInput.extend({
  segmentId: id,
  name: filter,
});

export const AddSegmentMembersInput = z.object({
  segmentId: id,
  originType: SegmentEntryOrigin,
  // 逐行填：原型 agenda-timeline.html 的环节人员弹窗里，环节身份是每行一个
  // 下拉、备注是每行一个输入框。
  entries: z
    .array(
      z.object({
        memberId: id,
        segmentRole: SegmentRoleEnum,
        ...relationFields,
      }),
    )
    .min(1, "请先选择人员")
    .max(200, "一次最多添加 200 人"),
});

export const UpdateSegmentMemberInput = z.object({
  id,
  segmentRole: SegmentRoleEnum,
  ...relationFields,
});

// --- 手动录入（三层共用的主档字段子集）---

/**
 * 从关系入口手动录入一个人时能填的主档字段。
 *
 * 刻意只取全量人员库那张表的一个子集：关系入口的场景是"名单上多了个人，先加
 * 进来"，籍贯、语种、邮箱这些留到全量人员库补全更合适；导入模板的必填项也只
 * 有姓名（文档 8.1.2 导入校验规则第 1 条），这里跟它对齐。
 *
 * 校验规则直接从 MemberFields 上 pick，不重写一份——手机号/证件号的正则只该
 * 有一个真相源，两处各写一遍迟早会漂移。
 */
const NewMemberFields = MemberFields.pick({
  name: true,
  gender: true,
  companyPosition: true,
  idType: true,
  idNumber: true,
  mobile: true,
  remark: true,
});

export const AddNewProjectMemberInput = z
  .object({ projectId: id, member: NewMemberFields })
  .superRefine((value, ctx) => validateIdNumber(value.member, ctx));

export const AddNewActivityMemberInput = z
  .object({
    activityId: id,
    member: NewMemberFields,
    ...relationFields,
  })
  .superRefine((value, ctx) => validateIdNumber(value.member, ctx));

export const AddNewSegmentMemberInput = z
  .object({
    segmentId: id,
    member: NewMemberFields,
    segmentRole: SegmentRoleEnum,
    ...relationFields,
  })
  .superRefine((value, ctx) => validateIdNumber(value.member, ctx));

// --- 候选人员（选择器的数据源）---

/**
 * 选择器要能按"上游范围"筛人，不是只能从全量库挑。
 *
 * 三个 scope 对应三种真实场景：加活动人员时通常从本项目已有的人里挑（他们已经
 * 是这个项目的人了，不用重新从几千人的全量库里翻）；加环节人员时通常从本活动
 * 人员里挑。全量库是兜底——名单上确实来了个新人时才需要。
 *
 * 返回行的形状三个 scope 完全一致，前端的选择器因此不用按 scope 分支渲染。
 */
export const ListMemberCandidatesInput = PageInput.extend({
  scope: z.enum(["all", "project", "activity"], { error: "范围不正确" }),
  projectId: id.optional(),
  activityId: id.optional(),
  name: filter,
}).superRefine((value, ctx) => {
  if (value.scope === "project" && value.projectId === undefined) {
    ctx.addIssue({ code: "custom", path: ["projectId"], message: "缺少项目" });
  }
  if (value.scope === "activity" && value.activityId === undefined) {
    ctx.addIssue({ code: "custom", path: ["activityId"], message: "缺少活动" });
  }
});
