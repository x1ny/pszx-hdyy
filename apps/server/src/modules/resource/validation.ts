import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import {
  DEMAND_HANDLINGS,
  RESOURCE_STATUSES,
  RESOURCE_TYPES,
  TRANSPORT_SCENES,
} from "./schema";

// 枚举一律带中文 error——不带的话前端 toast 里出现的是 zod 的英文默认文案。
const ResourceTypeEnum = z.enum(RESOURCE_TYPES, { error: "资源类型不正确" });
const DemandHandlingEnum = z.enum(DEMAND_HANDLINGS, {
  error: "处理要求不正确",
});
const TransportSceneEnum = z.enum(TRANSPORT_SCENES, {
  error: "用车场景不正确",
});
const ResourceStatusEnum = z.enum(RESOURCE_STATUSES, { error: "状态不正确" });

const id = z.number().int().positive();

/** 先 trim 再校验：一串空格能过 min(1)，存进去是条空记录。 */
const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

/**
 * 可选文本：空串和缺省都收敛成 **null，不是 undefined**。
 *
 * 这一个字的差别是个真 bug 的根源，值得写清楚：drizzle 的 `.set()` 会**跳过
 * 值为 undefined 的键**（那是它区分"不改这一列"和"把这一列改成 NULL"的方式）。
 * 所以如果这里吐 undefined，`/update` 就永远清不掉一个已经填过的文本字段——
 * 用户把"地点"删空、保存、刷新，旧值原封不动回来了。
 *
 * 更糟的是它会连带炸掉数据库约束：把一条用车记录改成物料时，前端不再提交
 * 车辆/司机（送 undefined），`.set()` 跳过这几列，旧的车牌号留在行上，
 * `chk_resource_transport_only` 当场翻脸——用户收到的是 500，不是一句人话。
 *
 * 吐 null 则两个问题一起没了：insert 时显式写 NULL（和省略等价），update 时
 * 显式清空。
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `不超过 ${max} 字`)
    .nullish()
    .transform((value) => value || null);

/** 筛选项：前端的"不筛"可能是空串也可能是缺省，统一收敛成 undefined。 */
const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const optionalCount = (label: string) =>
  z
    .number()
    .int(`${label}必须是整数`)
    .min(0, `${label}不能为负`)
    .max(999999, `${label}过大`)
    .nullish()
    .transform((value) => value ?? null);

// ---------------------------------------------------------------------------
// 环节资源需求项
// ---------------------------------------------------------------------------

const DemandItem = z.object({
  resourceType: ResourceTypeEnum,
  handling: DemandHandlingEnum,
  description: optionalText(1000),
  estimatedCount: optionalCount("预计数量"),
  ownerName: optionalText(64),
});

/**
 * 一个环节的需求项**整体替换**，不是逐条增删。
 *
 * 交互上这是一个弹窗里四个资源类型的开关一起保存，用整体替换语义正好对上：
 * 传进来的 upsert，没传的删掉（= 关闭该类需求）。逐条 create/update/delete
 * 三个接口的话，前端得自己算出"哪些是新增的、哪些被取消了"，然后发三批请求，
 * 中间任何一个失败就会留下半保存的状态。
 *
 * 空数组是合法入参，含义是"这个环节不需要任何资源"，会清空该环节的所有需求项。
 */
export const SaveSegmentDemandsInput = z.object({
  segmentId: id,
  demands: z
    .array(DemandItem)
    .max(RESOURCE_TYPES.length, "资源类型重复")
    // UNIQUE(segment_id, resource_type) 会在数据库层挡住，但那时报出来的是
    // 一条约束错误；这里提前判一次是为了给出人能看懂的话。
    .refine(
      (items) => new Set(items.map((i) => i.resourceType)).size === items.length,
      { message: "同一个环节的同类资源需求只能有一条" },
    ),
});

/**
 * 需求项一次全量返回，**不分页**——和 agenda/list 同一个理由：汇总页要按状态
 * 分组统计、议程页要按环节分组展示 chip，两个视图都必须拿到全集才算得对，
 * 按页取回来的统计是错的。一个活动的量级是「环节数 × 4」，几百条封顶。
 *
 * 因此也**没有单独的 stats 接口**：crud-page-guide 里"统计单独开接口"那条
 * 规矩的前提是列表分页、页面拿不到全集，这里前提不成立。
 */
export const ListDemandsInput = z.object({ activityId: id });

// ---------------------------------------------------------------------------
// 活动级资源台账
// ---------------------------------------------------------------------------

const ResourceFields = z
  .object({
    resourceType: ResourceTypeEnum,
    transportScene: TransportSceneEnum.nullish().transform((v) => v ?? null),
    name: required("资源名称", 255),
    quantity: optionalCount("数量"),
    startTime: z.coerce.date().nullish().transform((v) => v ?? null),
    endTime: z.coerce.date().nullish().transform((v) => v ?? null),
    location: optionalText(255),
    vehicleInfo: optionalText(128),
    driverName: optionalText(64),
    driverPhone: optionalText(32),
    ownerName: optionalText(64),
    remark: optionalText(1000),

    /**
     * 关联的环节需求项，**整体替换**（同 SaveSegmentDemandsInput 的理由）。
     * 空数组合法：活动通用资源（全场午餐、嘉宾酒店）本来就不挂任何环节需求。
     */
    demandIds: z
      .array(id)
      .default([])
      .transform((value) => [...new Set(value)]),
  })
  // 用车专属字段在非用车记录上必须为空。表上有同名 CHECK 兜底，但先在这里
  // 拦一次：用户"填了车牌又把类型改成物料"是最普通的操作序列，让他看到
  // 一句中文，而不是一条 Postgres 约束错误。
  .refine(
    (v) =>
      v.resourceType === "transport" ||
      (!v.transportScene && !v.vehicleInfo && !v.driverName && !v.driverPhone),
    {
      message: "用车场景、车辆和司机信息只能填在用车记录上",
      path: ["transportScene"],
    },
  )
  .refine((v) => v.resourceType !== "transport" || !!v.transportScene, {
    message: "请选择用车场景",
    path: ["transportScene"],
  })
  .refine((v) => !v.startTime || !v.endTime || v.startTime <= v.endTime, {
    message: "结束时间不能早于开始时间",
    path: ["endTime"],
  });

export const CreateResourceInput = ResourceFields.and(
  z.object({ activityId: id }),
);

/** 同环节：资源不支持改挂到另一场活动，activityId 不出现在修改入参里。 */
export const UpdateResourceInput = ResourceFields.and(z.object({ id }));

export const ResourceIdInput = z.object({ id });

/** 状态切换传目标值不传取反：toggle 不幂等，并发点两下结果不可预测。 */
export const SetResourceStatusInput = z.object({
  id,
  status: ResourceStatusEnum,
});

export const ListResourcesInput = PageInput.extend({
  activityId: id,
  resourceType: ResourceTypeEnum.optional(),
  transportScene: TransportSceneEnum.optional(),
  status: ResourceStatusEnum.optional(),
  keyword: filter,
  /** 从需求汇总页点进来时带上，用于只看某条需求关联的资源。 */
  demandId: id.optional(),
});

/** 台账列表是分页的，所以统计**必须**单独开接口，且不带筛选条件。 */
export const ResourceStatsInput = z.object({ activityId: id });

// ---------------------------------------------------------------------------
// 人员服务绑定
// ---------------------------------------------------------------------------

/**
 * 入参是**全量人员主档 id**，不是活动人员关系 id。
 *
 * 这不是偷懒：前端复用的是 features/member 的 MemberPickerDialog，它统一
 * 吐 memberId。服务端按 (activityId, memberId) 去 activity_member 换关系 id
 * ——那张表上 UNIQUE(activity_id, member_id)，换取是确定的；换不到就说明这
 * 个人根本不在本活动人员库里，正好在这里挡住（BR-DEV-033A：绑定对象必须
 * 来自活动人员关系）。
 */
export const BindResourceMembersInput = z.object({
  resourceId: id,
  memberIds: z
    .array(id)
    .min(1, "请选择要绑定的人员")
    .max(500, "一次最多绑定 500 人")
    .transform((value) => [...new Set(value)]),
});

export const UnbindResourceMemberInput = z.object({ id });
