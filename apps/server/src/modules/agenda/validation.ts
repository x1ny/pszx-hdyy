import { z } from "zod";
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
  sortOrder: z.number().int().min(0, "排序不正确").max(999, "排序过大").default(0),
});

/**
 * name 是可选的：主线允许清空名字（清空后前端展示成"主线"），并行线不允许
 * ——"某个 lineType 下才必填"要拿到目标行才知道，所以这条校验在 routes 里。
 */
export const UpdateAgendaLineInput = z.object({
  id,
  name: optionalText(64),
  sortOrder: z.number().int().min(0, "排序不正确").max(999, "排序过大").default(0),
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
