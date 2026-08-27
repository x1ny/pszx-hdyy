import { z } from "zod";
import { SEAT_KINDS, SEAT_RANKS } from "../venue/schema";
import { PLAN_STATUSES } from "./schema";

const id = z.number().int().positive();

const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

const PlanStatusEnum = z.enum(PLAN_STATUSES, { error: "方案状态不正确" });
const SeatKindEnum = z.enum(SEAT_KINDS, { error: "位置种类不正确" });
const SeatRankEnum = z.enum(SEAT_RANKS, { error: "位置等级不正确" });

const externalId = z
  .string()
  .trim()
  .min(1, "元素标识不能为空")
  .max(128, "元素标识过长");

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

export const ListPlansInput = z.object({
  activityId: id,
  /** 从环节详情进入时只看该环节的排位范围。 */
  segmentId: id.optional(),
  status: PlanStatusEnum.optional(),
});

export const PlanIdInput = z.object({ planId: id });

export const ActivityIdInput = z.object({ activityId: id });

export const ListCandidatesInput = z.object({
  planId: id,
  keyword: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
});

// ---------------------------------------------------------------------------
// 画布（写路径一：改"有哪些位置"）
// ---------------------------------------------------------------------------

/** 同 venue：服务端不解析 `data`，只确认它是个 JSON 对象或数组。 */
const LayoutBlobInput = z.object({
  rendererKind: required("渲染器标识", 64),
  rendererVersion: z.number().int().min(1, "渲染器版本不正确"),
  data: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())], {
    error: "画布数据必须是对象或数组",
  }),
});

const PlanSeatDraftInput = z.object({
  externalId,
  /** 从活动区域复制过来时带上，之后新增的位置没有来源。 */
  sourceExternalId: externalId.nullish(),
  label: required("位置编号", 64),
  kind: SeatKindEnum.default("seat"),
  rank: SeatRankEnum.default("normal"),
  enabled: z.boolean().default(true),
  ordinal: z.number().int().min(0).default(0),
});

/** 编号唯一性守在这里，理由同 venue：数据库那条 partial unique 挡不住编号对调。 */
const uniqueSeats = (
  input: { seats: z.infer<typeof PlanSeatDraftInput>[] },
  ctx: z.RefinementCtx,
) => {
  const ids = new Set<string>();
  const labels = new Set<string>();

  for (const seat of input.seats) {
    if (ids.has(seat.externalId)) {
      ctx.addIssue({
        code: "custom",
        path: ["seats"],
        message: `位置标识重复：${seat.externalId}`,
      });
    }
    ids.add(seat.externalId);

    // 只有启用的位置参与编号查重：停用的位置留在方案里只是"这次不用"，
    // 它跟别人重号不会造成任何实际歧义。
    if (!seat.enabled) continue;
    if (labels.has(seat.label)) {
      ctx.addIssue({
        code: "custom",
        path: ["seats"],
        message: `编号重复：${seat.label}`,
      });
    }
    labels.add(seat.label);
  }
};

/**
 * 建方案。**第一次保存就直接建 `pending` 的行，没有草稿态**（BR-DEV-010）。
 *
 * 座位不是服务端从活动区域捞出来的，是**前端投影好了传进来的**——活动区域的
 * 座位躺在那份不透明的画布 blob 里，只有前端的编辑器认识它的格式。服务端始终
 * 不解析 blob，这条不变量在这里也一样成立。
 */
export const CreatePlanInput = z
  .object({
    segmentId: id,
    activityVenueZoneId: id,
    layout: LayoutBlobInput,
    seats: z.array(PlanSeatDraftInput).max(5000, "位置数量超出上限"),
  })
  .superRefine(uniqueSeats);

export const SavePlanLayoutInput = z
  .object({
    planId: id,
    layout: LayoutBlobInput,
    seats: z.array(PlanSeatDraftInput).max(5000, "位置数量超出上限"),
  })
  .superRefine(uniqueSeats);

export type SavePlanLayoutPayload = z.infer<typeof SavePlanLayoutInput>;
export type CreatePlanPayload = z.infer<typeof CreatePlanInput>;

// ---------------------------------------------------------------------------
// 分配（写路径二：改"谁坐哪"）
//
// 注意这几个入参里**没有任何几何**，画布保存的入参里也没有任何人——
// 两条写路径正交（§3.2）。
// ---------------------------------------------------------------------------

export const AssignInput = z.object({
  planId: id,
  segmentSeatId: id,
  /** 环节人员 id。不是活动人员，也不是人员主档（§8）。 */
  segmentMemberId: id,
});

/** 团体占位：团体必须由服务端验证处于当前方案环节的范围快照中。 */
export const AssignOrganizationInput = z.object({
  planId: id,
  segmentSeatId: id,
  organizationId: id,
});

export const UnassignInput = z.object({ planId: id, segmentSeatId: id });

/** 团体批量占位的目标数：可跟随当前未个人排座人数，或由操作者明确指定。 */
const OrganizationSeatTargetInput = z.discriminatedUnion("targetMode", [
  z.object({ targetMode: z.literal("remaining") }),
  z.object({
    targetMode: z.literal("custom"),
    targetCount: id,
  }),
]);

/**
 * 有序位置 id 是排位者的显式选择顺序，不在服务端做邻近位置等智能优化。
 * 重复 id 没有业务意义，而且会让预览容量和实际插入容量不一致，因此入参直接拒绝。
 */
export const OrganizationSeatBatchInput = z
  .object({
    planId: id,
    organizationId: id,
    orderedSeatIds: z.array(id).max(5000, "位置数量超出上限"),
  })
  .and(OrganizationSeatTargetInput)
  .superRefine((input, ctx) => {
    const seen = new Set<number>();
    for (const [index, seatId] of input.orderedSeatIds.entries()) {
      if (seen.has(seatId)) {
        ctx.addIssue({
          code: "custom",
          path: ["orderedSeatIds", index],
          message: `位置重复：${seatId}`,
        });
      }
      seen.add(seatId);
    }
  });

export type OrganizationSeatBatchPayload = z.infer<
  typeof OrganizationSeatBatchInput
>;

/** 解除当前方案内一个团体的全部有效占位，不影响任何个人分配。 */
export const UnassignOrganizationInput = z.object({
  planId: id,
  organizationId: id,
});

export const SwapInput = z.object({
  planId: id,
  seatAId: id,
  seatBId: id,
});

/**
 * 把活动人员补进环节再排座。
 *
 * "排座会往环节人员表写行"是分配指向 `segment_member` 这个选择的明确副作用，
 * 不是意外——它就是"被排进这个环节座位的人，即本环节人员"这句话的数据表达。
 */
export const AssignActivityMemberInput = z.object({
  planId: id,
  segmentSeatId: id,
  activityMemberId: id,
});

/**
 * 本环节启用/停用一个位置。**独立的即时写路径，不经过 `saveLayout`。**
 *
 * `enabled` 曾经跟几何一起打包进画布保存——排位画布重做成"排位阶段不能再编辑
 * 布局，只能入座"之后，画布保存整个从这个阶段消失了，但启用/停用是业务状态
 * 不是几何，不该被一起下掉。拆成单独接口后它跟 assign/unassign 是同一种性质
 * 的操作：立即生效、立即在 `segment_seating_log` 留痕。
 */
export const SetSeatEnabledInput = z.object({
  planId: id,
  segmentSeatId: id,
  enabled: z.boolean(),
});

// ---------------------------------------------------------------------------
// 状态流转
// ---------------------------------------------------------------------------

export const ConfirmPlanInput = z.object({ planId: id });

export const RejectPlanInput = z.object({
  planId: id,
  reason: required("退回原因", 500),
});

export const VoidPlanInput = z.object({ planId: id });
