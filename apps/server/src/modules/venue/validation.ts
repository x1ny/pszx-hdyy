import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import {
  ACTIVITY_VENUE_STATUSES,
  SEAT_KINDS,
  SEAT_RANKS,
  VENUE_STATUSES,
  ZONE_KINDS,
  ZONE_PURPOSES,
} from "./schema";

// 枚举一律带中文 error：这些 message 会被前端直接丢进 toast，漏一个就露出
// zod 的英文默认文案。
const VenueStatusEnum = z.enum(VENUE_STATUSES, { error: "状态不正确" });
const ZoneKindEnum = z.enum(ZONE_KINDS, { error: "区域类型不正确" });
const SeatKindEnum = z.enum(SEAT_KINDS, { error: "位置种类不正确" });
const SeatRankEnum = z.enum(SEAT_RANKS, { error: "位置等级不正确" });

const id = z.number().int().positive();

/** 先 trim 再校验：否则「一串空格」能过 min(1)。 */
const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

/** 筛选项：前端的「不筛」可能是空串也可能是缺省，统一收敛成 undefined。 */
const filter = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

// ---------------------------------------------------------------------------
// 场地主记录
// ---------------------------------------------------------------------------

export const VenueInput = z.object({
  name: required("场地名称", 255),
  address: z.string().trim().max(255, "地址过长").optional(),
  description: z.string().trim().max(1000, "说明过长").optional(),
  status: VenueStatusEnum.default("enabled"),
});

export const CreateVenueInput = VenueInput;

export const UpdateVenueInput = VenueInput.extend({ id });

export const VenueIdInput = z.object({ id });

/** 传目标状态而不是取反：toggle 不幂等，重试一次结果就不可预测。 */
export const SetVenueStatusInput = z.object({ id, status: VenueStatusEnum });

export const ListVenuesInput = PageInput.extend({
  name: filter,
  address: filter,
  status: VenueStatusEnum.optional(),
});

// ---------------------------------------------------------------------------
// 画布保存
// ---------------------------------------------------------------------------

const externalId = z
  .string()
  .trim()
  .min(1, "元素标识不能为空")
  .max(128, "元素标识过长");

const ZoneDraftInput = z.object({
  externalId,
  name: required("区域名称", 128),
  kind: ZoneKindEnum,
  ordinal: z.number().int().min(0).default(0),
});

const SeatDraftInput = z.object({
  externalId,
  zoneExternalId: externalId,
  label: required("位置编号", 64),
  kind: SeatKindEnum.default("seat"),
  rank: SeatRankEnum.default("normal"),
  ordinal: z.number().int().min(0).default(0),
});

/**
 * 画布本身。**服务端不校验也不解析 `data`**，只确认它是个 JSON 对象或数组
 * ——挡掉把标量或 `null` 当画布存进来的调用，同时一个字节都不往里看。
 *
 * 不用 `z.unknown()`：zod 会把它推成可选字段，"画布数据缺失"就悄悄变成合法输入了。
 */
const LayoutBlobInput = z.object({
  rendererKind: required("渲染器标识", 64),
  rendererVersion: z.number().int().min(1, "渲染器版本不正确"),
  data: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())], {
    error: "画布数据必须是对象或数组",
  }),
});

/**
 * 上界不是防御性编程，是防止一次请求把整张表写爆。2000 是
 * docs/场地排位底层设计.md §13.0 里"该重新评估 Konva"的信号线，
 * 留一倍余量到 5000——真撞上说明该换渲染方案了，不该靠放大上限硬扛。
 */
export const SaveVenueLayoutInput = z
  .object({
    venueId: id,
    layout: LayoutBlobInput,
    zones: z.array(ZoneDraftInput).max(200, "区域数量超出上限"),
    seats: z.array(SeatDraftInput).max(5000, "位置数量超出上限"),
  })
  .superRefine((input, ctx) => {
    // 这四条是"投影出来的语义"层面的校验。放 superRefine 而不是 handler：
    // 它们只看入参、不看库，属于契约的一部分，且能在一次校验里把问题一起报出来。
    const zoneIds = new Set<string>();
    for (const zone of input.zones) {
      if (zoneIds.has(zone.externalId)) {
        ctx.addIssue({
          code: "custom",
          path: ["zones"],
          message: `区域标识重复：${zone.externalId}`,
        });
      }
      zoneIds.add(zone.externalId);
    }

    const seatIds = new Set<string>();
    /** 同一区域内的编号不能撞，跨区域可以（A 区和 B 区都能有 A1）。 */
    const labelsByZone = new Map<string, Set<string>>();

    for (const seat of input.seats) {
      if (seatIds.has(seat.externalId)) {
        ctx.addIssue({
          code: "custom",
          path: ["seats"],
          message: `位置标识重复：${seat.externalId}`,
        });
      }
      seatIds.add(seat.externalId);

      if (!zoneIds.has(seat.zoneExternalId)) {
        ctx.addIssue({
          code: "custom",
          path: ["seats"],
          message: `位置 ${seat.label} 指向了不存在的区域`,
        });
        continue;
      }

      const labels = labelsByZone.get(seat.zoneExternalId) ?? new Set<string>();
      if (labels.has(seat.label)) {
        ctx.addIssue({
          code: "custom",
          path: ["seats"],
          message: `同一区域内编号重复：${seat.label}`,
        });
      }
      labels.add(seat.label);
      labelsByZone.set(seat.zoneExternalId, labels);
    }
  });

export const GetVenueLayoutInput = z.object({ venueId: id });

/** 归并函数的入参类型，routes.ts 用它标注 applyLayout 的签名。 */
export type SaveVenueLayoutPayload = z.infer<typeof SaveVenueLayoutInput>;

// ---------------------------------------------------------------------------
// 活动场地空间
// ---------------------------------------------------------------------------

const ZonePurposeEnum = z.enum(ZONE_PURPOSES, { error: "活动用途不正确" });
const ActivityVenueStatusEnum = z.enum(ACTIVITY_VENUE_STATUSES, {
  error: "状态不正确",
});

export const ActivityIdInput = z.object({ activityId: id });

/**
 * 从场地库导入一个场地。**只传两个 id**——名称、地址、区域、几何全部由服务端
 * 从场地库当场读出来拷贝，不让前端传：前端传什么就存什么的话，这份"快照"到底
 * 快照了哪一刻就说不清了。
 */
export const ImportActivityVenueInput = z.object({
  activityId: id,
  venueId: id,
});

export const ActivityVenueIdInput = z.object({ id });

export const UpdateActivityVenueInput = z.object({
  id,
  name: required("场地名称", 255),
  note: z.string().trim().max(1000, "使用说明过长").optional(),
  status: ActivityVenueStatusEnum,
});

/**
 * 编辑一个活动区域。**改不了 `kind` 和 `externalId`**：前者是源场地的固有属性
 * （这块地方是什么），后者是这一行跟画布图形的纽带，改了就对不上了。活动层
 * 能改的只有"这场活动拿它干什么"这三件事。
 */
export const UpdateActivityVenueZoneInput = z.object({
  id,
  name: required("区域名称", 128),
  purpose: ZonePurposeEnum,
  capacity: z
    .number()
    .int()
    .min(0, "可用点位不能为负")
    .max(100000, "可用点位过大"),
  status: ActivityVenueStatusEnum,
  note: z.string().trim().max(1000, "说明过长").optional(),
});

export const SetActivityVenueZoneStatusInput = z.object({
  id,
  status: ActivityVenueStatusEnum,
});

export const GetActivityVenueLayoutInput = z.object({ activityVenueId: id });

/**
 * 活动空间自己的画布保存。跟场地库的 `SaveVenueLayoutInput` 同构——同一个编辑器、
 * 同一份投影契约——区别只是这里不用再传座位：活动层**不落座位行**（底层设计
 * §3.3），座位只在 blob 里，编辑器的投影里也没有座位那部分要落库。
 */
export const SaveActivityVenueLayoutInput = z
  .object({
    activityVenueId: id,
    layout: LayoutBlobInput,
    zones: z.array(ZoneDraftInput).max(200, "区域数量超出上限"),
  })
  .superRefine((input, ctx) => {
    const zoneIds = new Set<string>();
    for (const zone of input.zones) {
      if (zoneIds.has(zone.externalId)) {
        ctx.addIssue({
          code: "custom",
          path: ["zones"],
          message: `区域标识重复：${zone.externalId}`,
        });
      }
      zoneIds.add(zone.externalId);
    }
  });

export type SaveActivityVenueLayoutPayload = z.infer<
  typeof SaveActivityVenueLayoutInput
>;
