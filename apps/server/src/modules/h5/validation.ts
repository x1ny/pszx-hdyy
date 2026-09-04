import { z } from "zod";

/** 和人员主档同一口径（member/validation.ts 的 mobile 规则）。 */
const mobile = z
  .string()
  .trim()
  .regex(/^1\d{10}$/, "请输入正确的手机号");

const activityId = z.coerce.number().int().positive();

export const SubmitPhoneInput = z.object({ activityId, mobile });

/**
 * **每个 `/api/h5/*` 接口的 body 里都必须有 `activityId`。**
 *
 * `requireH5Member` 直接从请求 body 里读它来解析人员（理由见 auth.ts 顶部）。
 * 新增接口时从这个 schema `.extend({...})` 出去，不要另起一个只有业务字段的
 * schema —— 少了这个字段，中间件解析不出人员，那条路由会整条返回
 * VALIDATION_ERROR。
 */
export const H5ScopedInput = z.object({ activityId });

export const GetItineraryInput = H5ScopedInput;
