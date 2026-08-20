import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import { ACTIVITY_TYPES, PUBLISH_STATUSES } from "./schema";

const PublishStatusEnum = z.enum(PUBLISH_STATUSES, {
  error: "发布状态不正确",
});
const ActivityTypeEnum = z.enum(ACTIVITY_TYPES, { error: "活动类型不正确" });

const id = z.number().int().positive();

/** 先 trim 再校验：一串空格能过 min(1)，存进去是条空记录。 */
const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

/**
 * 可选文本字段：空串收敛成 undefined，不把 "" 存进一个语义上是"没填"的
 * 可空列——不然列表页判断"有没有主办单位"永远要多写一个 `!== ""`。
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "不超过 " + max + " 字")
    .optional()
    .transform((value) => value || undefined);

/** 筛选项：前端的"不筛"可能是空串也可能是缺省，统一收敛成 undefined。 */
const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const optionalBudget = z.coerce
  .number({ error: "总预算必须是数字" })
  .nonnegative("总预算不能为负数")
  .optional();

// ---------------------------------------------------------------------------
// 项目
// ---------------------------------------------------------------------------

export const ProjectInput = z
  .object({
    name: required("项目名称", 255),
    location: optionalText(255),
    // 新增和编辑项目时，开始/结束时间必须成对填写；历史数据仍可能为空。
    startTime: z.coerce.date("开始时间不能为空"),
    endTime: z.coerce.date("结束时间不能为空"),
    totalBudget: optionalBudget,
    hostOrg: optionalText(255),
    organizerOrg: optionalText(255),
    supportOrg: optionalText(255),
    guidingOrg: optionalText(255),
    description: optionalText(2000),
    publishStatus: PublishStatusEnum.default("draft"),
  })
  .refine((value) => value.startTime < value.endTime, {
    message: "结束时间必须晚于开始时间",
    path: ["endTime"],
  });

export const CreateProjectInput = ProjectInput;

export const UpdateProjectInput = ProjectInput.and(z.object({ id }));

export const ProjectIdInput = z.object({ id });

export const SetProjectPublishStatusInput = z.object({
  id,
  publishStatus: PublishStatusEnum,
});

export const ListProjectsInput = PageInput.extend({
  name: filter,
  publishStatus: PublishStatusEnum.optional(),
  // 列表日期筛选使用日期字符串，避免把浏览器本地日期误当成 UTC 时刻。
  startTime: z.iso.date().optional(),
  endTime: z.iso.date().optional(),
}).refine(
  (value) =>
    !value.startTime || !value.endTime || value.startTime <= value.endTime,
  { message: "结束时间不能早于开始时间", path: ["endTime"] },
);

// ---------------------------------------------------------------------------
// 活动
// ---------------------------------------------------------------------------

/** 新增和修改共用的字段集合；projectId 不在这里——见下面两个 Input 的说明。 */
const ActivityFields = z
  .object({
    activityType: ActivityTypeEnum,
    name: required("活动名称", 255),
    location: optionalText(255),
    // 活动时间必填：环节/议程、报名前置条件、H5 展示条件都挂在真实时刻上，
    // 服务端 schema 也用 NOT NULL + CHECK(start < end) 兜底，这里提前给出
    // 中文提示，不用等保存失败才知道错在哪。
    startTime: z.coerce.date("开始时间不能为空"),
    endTime: z.coerce.date("结束时间不能为空"),
    totalBudget: optionalBudget,
    hostOrg: optionalText(255),
    organizerOrg: optionalText(255),
    supportOrg: optionalText(255),
    guidingOrg: optionalText(255),
    description: optionalText(2000),
    publishStatus: PublishStatusEnum.default("draft"),
    displayEnabled: z.boolean().default(false),
    registrationEnabled: z.boolean().default(false),
  })
  .refine((value) => value.startTime < value.endTime, {
    message: "结束时间必须晚于开始时间",
    path: ["endTime"],
  });

/**
 * 活动永远从项目详情页创建，projectId 来自当前页面上下文，不是表单里
 * 用户挑出来的一个字段——所以它在 Create 时是必填输入，但从不出现在
 * 编辑表单里（活动不支持"改到另一个项目下"，这不是本期要支持的操作）。
 */
export const CreateActivityInput = ActivityFields.and(
  z.object({ projectId: id }),
);

export const UpdateActivityInput = ActivityFields.and(z.object({ id }));

export const ActivityIdInput = z.object({ id });

export const SetActivityPublishStatusInput = z.object({
  id,
  publishStatus: PublishStatusEnum,
});

export const SetActivityDisplayEnabledInput = z.object({
  id,
  displayEnabled: z.boolean(),
});

export const SetActivityRegistrationEnabledInput = z.object({
  id,
  registrationEnabled: z.boolean(),
});

export const ListActivitiesInput = PageInput.extend({
  // 活动没有独立一级菜单，列表永远在某个项目详情页下打开，projectId 必填。
  projectId: id,
  name: filter,
  activityType: ActivityTypeEnum.optional(),
  publishStatus: PublishStatusEnum.optional(),
});
