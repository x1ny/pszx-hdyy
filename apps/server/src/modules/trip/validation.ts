import { z } from "zod";
import { PageInput } from "../../shared/pagination";
import { TRANSPORT_MODES } from "./schema";

const id = z.number().int().positive();
const TransportModeEnum = z.enum(TRANSPORT_MODES, { error: "交通方式不正确" });

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

/** 单人和批量录入共用的行程字段；人员范围由各自的输入另行声明。 */
const TripPayloadFields = z.object({
  transportMode: TransportModeEnum,
  serviceNumber: optionalText("航班/车次", 64),
  departureTime: z.coerce.date({ error: "出发时间不正确" }),
  arrivalTime: z.coerce.date({ error: "到达时间不正确" }),
  departureLocation: required("出发地", 255),
  destination: required("目的地", 255),
});

const timeRangeIsValid = (value: { departureTime: Date; arrivalTime: Date }) =>
  value.departureTime < value.arrivalTime;

const timeRangeError = {
  message: "到达时间必须晚于出发时间",
  path: ["arrivalTime"],
};

export const TripFields = z
  .object({
    activityId: id,
    activityMemberId: id,
    segmentId: id.nullish().transform((value) => value ?? null),
    ...TripPayloadFields.shape,
  })
  .refine(timeRangeIsValid, timeRangeError);

export const CreateTripInput = TripFields;
export const UpdateTripInput = TripFields.safeExtend({ id });
export const TripIdInput = z.object({ id });
export const TripOptionsInput = z.object({ activityId: id });
/** 批量录入的选择器：传入环节后，团体和人员都切换到该环节范围快照。 */
export const BatchTripOptionsInput = z.object({
  activityId: id,
  segmentId: id.nullish().transform((value) => value ?? null),
});

/**
 * 一次提交为每个 activityMemberId 各建一条行程。这里故意**不去重**：同一
 * 人可能有两段独立行程，调用方传入几个 id 就必须得到几条记录。
 */
export const CreateBatchTripsInput = z
  .object({
    activityId: id,
    organizationId: id,
    segmentId: id.nullish().transform((value) => value ?? null),
    activityMemberIds: z.array(id).min(1, "至少选择一名人员"),
    ...TripPayloadFields.shape,
  })
  .refine(timeRangeIsValid, timeRangeError);
export const ListMemberTripsInput = z.object({ memberId: id });

export const ListTripsInput = PageInput.extend({
  activityId: id,
  name: filter,
  companyPosition: filter,
  transportMode: TransportModeEnum.optional(),
});
