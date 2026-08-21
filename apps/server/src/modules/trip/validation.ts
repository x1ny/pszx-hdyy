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

export const TripFields = z
  .object({
    activityId: id,
    activityMemberId: id,
    segmentId: id.nullish().transform((value) => value ?? null),
    transportMode: TransportModeEnum,
    serviceNumber: optionalText("航班/车次", 64),
    departureTime: z.coerce.date({ error: "出发时间不正确" }),
    arrivalTime: z.coerce.date({ error: "到达时间不正确" }),
    departureLocation: required("出发地", 255),
    destination: required("目的地", 255),
  })
  .refine((value) => value.departureTime < value.arrivalTime, {
    message: "到达时间必须晚于出发时间",
    path: ["arrivalTime"],
  });

export const CreateTripInput = TripFields;
export const UpdateTripInput = TripFields.safeExtend({ id });
export const TripIdInput = z.object({ id });
export const TripOptionsInput = z.object({ activityId: id });
export const ListMemberTripsInput = z.object({ memberId: id });

export const ListTripsInput = PageInput.extend({
  activityId: id,
  name: filter,
  companyPosition: filter,
  transportMode: TransportModeEnum.optional(),
});
