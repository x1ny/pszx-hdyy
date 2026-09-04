import { z } from "zod";
import {
  NewMemberFields,
  SegmentRoleEnum,
  validateIdNumber,
} from "../member/validation";
import {
  DEMAND_HANDLINGS,
  RESOURCE_TYPES,
  TRANSPORT_SCENES,
} from "../resource/schema";
import { SEGMENT_STATUSES, SEGMENT_TYPES } from "./schema";

const SegmentTypeEnum = z.enum(SEGMENT_TYPES, { error: "环节类型不正确" });
const SegmentStatusEnum = z.enum(SEGMENT_STATUSES, { error: "环节状态不正确" });

const id = z.number().int().positive();

/** 先 trim 再校验：一串空格能过 min(1)，存进去是条空记录。 */
const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

/** 可选文本：空串收敛成 undefined，不把 "" 存进语义上是"没填"的可空列。 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `不超过 ${max} 字`)
    .optional()
    .transform((value) => value || undefined);

/**
 * 同上，但空值收敛成 **null 而不是 undefined**。
 *
 * 差这一个字是个真 bug 的根源（详细版写在 resource/validation.ts）：drizzle 的
 * `.set()` 会跳过值为 undefined 的键——那是它区分"不改这一列"和"改成 NULL"的
 * 方式。资源安排走的是 update 路径，吐 undefined 的话用户永远清不掉一个已经
 * 填过的字段：把"地点"删空、保存、刷新，旧值原封不动回来。
 *
 * 环节自己的字段用上面那个 optionalText 就够——它只走 insert / 全量 set。
 */
const optionalNullText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `不超过 ${max} 字`)
    .nullish()
    .transform((value) => value || null);

// ---------------------------------------------------------------------------
// 环节
// ---------------------------------------------------------------------------

/**
 * 新增和修改共用的字段集合。
 *
 * **没有"线路内顺序"**——同一议程线内时间重叠是阻断的，时间本身已经全序，
 * 再存一份手填的顺序号只会和时间打架（BR-DEV-031：议程顺序调整通过编辑
 * 环节时间完成）。列表里的顺序号由前端按「线内第几个」算。取舍详见
 * docs/agenda-module-plan.md §1.4。
 */
const SegmentFields = z
  .object({
    name: required("环节名称", 255),
    segmentType: SegmentTypeEnum,

    // null 表示"放主线"：主线是懒创建的，第一个主线环节保存时由服务端在
    // 同一个事务里建出来。并行线必须先显式创建（它必须有名字）。
    agendaLineId: id.nullable().default(null),

    startTime: z.coerce.date("开始时间不能为空"),
    endTime: z.coerce.date("结束时间不能为空"),

    locationText: optionalText(255),
    description: optionalText(2000),
    ownerName: optionalText(64),

    memberEnabled: z.boolean().default(false),
    seatingEnabled: z.boolean().default(false),
  })
  // `<=` 而不是 `<`：允许零时长的瞬时环节（签到、剪彩），和表上的 CHECK 一致。
  .refine((value) => value.startTime <= value.endTime, {
    message: "结束时间不能早于开始时间",
    path: ["endTime"],
  });

/**
 * 环节永远从活动详情的议程标签页创建，activityId 来自页面上下文；修改时
 * 不出现在入参里——环节不支持"改挂到另一场活动"，那不是本期要支持的操作
 * （而且复合外键也不允许它跨活动挂线）。
 */
export const CreateSegmentInput = SegmentFields.and(
  z.object({ activityId: id }),
);

export const UpdateSegmentInput = SegmentFields.and(z.object({ id }));

export const SegmentIdInput = z.object({ id });

/** 状态切换传目标值不传取反：toggle 不幂等，并发点两下结果不可预测。 */
export const SetSegmentStatusInput = z.object({
  id,
  status: SegmentStatusEnum,
});

// ---------------------------------------------------------------------------
// 议程线
// ---------------------------------------------------------------------------

/**
 * 只用来建**并行线**：主线由 createSegment 懒创建，不给第二条创建路径
 * ——两条路径就要各写一遍唯一约束冲突的处理。
 */
export const CreateAgendaLineInput = z.object({
  activityId: id,
  name: required("线路名称", 64),
  sortOrder: z
    .number()
    .int()
    .min(0, "排序不正确")
    .max(999, "排序过大")
    .default(0),
});

/**
 * name 是可选的：主线允许清空名字（清空后前端展示成"主线"），并行线不允许
 * ——"某个 lineType 下才必填"要拿到目标行才知道，所以这条校验在 routes 里。
 */
export const UpdateAgendaLineInput = z.object({
  id,
  name: optionalText(64),
  sortOrder: z
    .number()
    .int()
    .min(0, "排序不正确")
    .max(999, "排序过大")
    .default(0),
});

export const AgendaLineIdInput = z.object({ id });

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/**
 * 议程一次全量返回，**不分页**——这是"分页接口统一走 PageInput"的一个显式
 * 例外，理由是时间轴必须拿到全部环节才能算轴范围和并行区块，按页画出来的
 * 图是错的；一个活动的环节量在几十条量级，不是需要分页的数据规模。
 *
 * 也**不带 includeVoided 开关**：作废环节一起返回，由前端按视图过滤（时间轴
 * 只画正常的，列表可以选择显示全部）。这样统计磁贴不用再单开一个 stats
 * 接口——crud-page-guide 里"统计单独开接口"那条规矩的前提是列表分页、
 * 页面拿不到全集，这里前提不成立。
 */
export const ListAgendaInput = z.object({ activityId: id });

// ---------------------------------------------------------------------------
// 环节配置（单页聚合读写）
// ---------------------------------------------------------------------------

/**
 * 草稿里还没有真 id 的对象用它占位。
 *
 * 环节配置页是整页原子保存：新建环节时，"手动录入一个人 → 把他加进本环节 →
 * 建一辆车 → 把这个人绑到车上"是一次提交，中间那些对象在提交的瞬间都还没有
 * 主键。前端为它们各生成一个 tempKey，服务端建完之后按 key 查回真 id。
 *
 * **tempKey 从不落库**，它只在这一次请求体里有意义。
 */
const tempKey = z.string().trim().min(1, "缺少临时标识").max(64);

/**
 * 绑定目标：已有的活动人员关系，或本次草稿里新加的人。
 *
 * 用 activityMemberId 而不是 memberId，是因为环节配置页的候选池就是本环节
 * 人员——他们本来就带着活动关系 id，多绕一次换算只会多一次可能失败的查询。
 */
const BindTarget = z.union([
  z.object({ activityMemberId: id }),
  z.object({ memberTempKey: tempKey }),
]);

/**
 * 人员改动用**意图**表达，不是"目标状态"。
 *
 * 这一条是新旧两套界面能并存的前提。如果发的是完整名单、服务端照着改成一致，
 * 那么 A 打开页面 20 分钟、期间 B 用旧弹窗加了个人，A 保存时就会把 B 加的人
 * 静默删掉——因为那个人不在 A 的名单里。发意图则只执行"我动过的这几件事"，
 * 没动过的行不受影响。
 */
const SegmentConfigMembers = z.object({
  /** 从已有人员库选中的人。 */
  add: z
    .array(
      z.object({
        tempKey,
        memberId: id,
        segmentRole: SegmentRoleEnum,
      }),
    )
    .default([]),

  /** 手动录入的新人：先建主档，再补齐项目/活动/环节三层关系。 */
  addNew: z
    .array(
      z
        .object({
          tempKey,
          member: NewMemberFields,
          segmentRole: SegmentRoleEnum,
        })
        .superRefine((value, ctx) => validateIdNumber(value.member, ctx)),
    )
    .default([]),

  /** segment_member.id —— 本次要移出本环节的人。 */
  remove: z.array(id).default([]),

  /**
   * 确认一并解除被移除人员的排位。
   *
   * 移除一个已经排了座的人会连带解除他的个人座位、以及他所在团体在本环节的
   * 团体占位（他若是最后一人）。这是不可逆的，所以走两段确认：第一次保存不带
   * 这个标记，服务端把受影响的座位号列出来并拒绝；页面弹确认框，用户点确认后
   * 带 true 再存一次。
   *
   * 和旧的移除弹窗（segmentMember/remove 的 `cascade`）是同一套口径——那边是
   * 点"移除"的当下问，这边因为是草稿，只能等到保存时才知道。
   */
  cascadeSeats: z.boolean().default(false),

  /** 只改环节身份；来源/分组/负责人的环节级覆盖本期不给入口。 */
  updateRoles: z
    .array(z.object({ relationId: id, segmentRole: SegmentRoleEnum }))
    .default([]),
});

/**
 * 一条资源安排。**不带 resourceType**——它等于所属需求的类型（Q12：类型跟着
 * 需求走）。这不只是省一个字段：`checkDemandsLinkable` 本来就拒绝跨类型关联，
 * 让前端传一个必然等于需求类型的值，只是多给它一次传错的机会。
 */
const ResourceDraftFields = z.object({
  transportScene: z
    .enum(TRANSPORT_SCENES, { error: "用车场景不正确" })
    .nullish()
    .transform((v) => v ?? null),
  name: required("资源名称", 128),
  quantity: z
    .number()
    .int("数量必须是整数")
    .min(0, "数量不能为负")
    .max(999999, "数量过大")
    .nullish()
    .transform((v) => v ?? null),
  startTime: z.coerce
    .date()
    .nullish()
    .transform((v) => v ?? null),
  endTime: z.coerce
    .date()
    .nullish()
    .transform((v) => v ?? null),
  location: optionalNullText(255),
  vehicleInfo: optionalNullText(128),
  driverName: optionalNullText(64),
  driverPhone: optionalNullText(32),
  ownerName: optionalNullText(64),
  remark: optionalNullText(1000),
});

/**
 * 一条需求下挂着的资源安排。两种形态：
 *
 * - `create`：这次新建一条活动级资源记录，并挂到本需求上。
 * - `existing`：已经关联的、或本次从台账里"关联已有资源"选进来的。关联动作是
 *   幂等的（ensureDemandLink 走 onConflictDoNothing），所以两种情况用同一个
 *   分支即可，前端不用记住"这条是原本就有的还是刚挂上的"。
 */
const SegmentConfigResource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    tempKey,
    fields: ResourceDraftFields,
    bindTargets: z.array(BindTarget).default([]),
  }),
  z.object({
    kind: z.literal("existing"),
    resourceId: id,
    /** null = 本次不改这条资源的字段，只是保持/建立关联。 */
    fields: ResourceDraftFields.nullish().transform((v) => v ?? null),
    bindTargets: z.array(BindTarget).default([]),
    /** resource_member_binding.id —— 本次要解除的绑定。 */
    unbindIds: z.array(id).default([]),
  }),
]);

/**
 * 需求项。四类矩阵不变（一个环节每类最多一条），resourceType 同时充当这条
 * 需求在本次请求里的标识——不需要给需求也发 tempKey。
 */
const SegmentConfigDemand = z
  .object({
    resourceType: z.enum(RESOURCE_TYPES, { error: "资源类型不正确" }),
    handling: z.enum(DEMAND_HANDLINGS, { error: "处理要求不正确" }),
    description: optionalNullText(2000),
    estimatedCount: z
      .number()
      .int("预计数量必须是整数")
      .min(0, "预计数量不能为负")
      .max(999999, "预计数量过大")
      .nullish()
      .transform((v) => v ?? null),
    ownerName: optionalNullText(64),

    resources: z.array(SegmentConfigResource).default([]),
    /** 解除关联：资源留在台账里，只是不再服务这条需求。 */
    unlinkResourceIds: z.array(id).default([]),
    /** 作废资源：活动级的报废动作，前端有二次确认。 */
    voidResourceIds: z.array(id).default([]),
  })
  // `record_only` 按定义不产生台账记录，checkDemandsLinkable 也会拒绝关联。
  // 在入参这一层先挡一次，让用户看到的是一句人话而不是写到一半才失败。
  .refine(
    (value) => value.handling === "arrange" || value.resources.length === 0,
    {
      message: "处理要求为「仅记录需求」时不需要配置资源安排",
      path: ["resources"],
    },
  );

/**
 * 环节配置页的整页保存。`segmentId` 为空就是新建。
 *
 * 需求项是**整体替换**（沿用 saveForSegment 的语义：传进来的 upsert、没传的
 * 删除），人员和资源安排是**增量意图**。两种语义混在一个入参里看着不齐整，
 * 但它们对应的是两种不同的现实：需求是四个格子的矩阵，页面永远拥有它的完整
 * 视野；人员和资源则可能有页面看不见的部分（别的环节加的人、别的需求共用的
 * 车），只能动自己明确动过的那几条。
 */
export const SaveSegmentConfigInput = z.object({
  activityId: id,
  segmentId: id.nullable().default(null),
  base: SegmentFields,
  /** lineKey 选了"新建并行线"时带上，服务端在同一个事务里先建线。 */
  newLineName: optionalText(64),
  members: SegmentConfigMembers.default({
    add: [],
    addNew: [],
    remove: [],
    updateRoles: [],
    cascadeSeats: false,
  }),
  demands: z.array(SegmentConfigDemand).default([]),
});

export const GetSegmentConfigInput = z.object({ segmentId: id });
