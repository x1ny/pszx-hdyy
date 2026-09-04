import { z } from "zod";

/** 和人员主档同一口径（member/validation.ts 的 mobile 规则）。 */
const mobile = z
  .string()
  .trim()
  .regex(/^1\d{10}$/, "请输入正确的手机号");

/**
 * H5 URL 的公开标识。长度只做滥用保护；无论格式像不像 token，查不到都按
 * NOT_FOUND 处理，前端直接打开一条失效链接时才能落到正确的 404 页面。
 */
const shareToken = z
  .string()
  .trim()
  .min(1, "分享链接不正确")
  .max(64, "分享链接不正确");

export const SubmitPhoneInput = z.object({ shareToken, mobile });

/**
 * **每个 `/api/h5/*` 接口的 body 里都必须有 `shareToken`。**
 *
 * `requireH5Member` 直接从请求 body 里读它，先解析活动、再在活动范围内解析人员
 * （理由见 auth.ts 顶部）。
 * 新增接口时从这个 schema `.extend({...})` 出去，不要另起一个只有业务字段的
 * schema —— 少了这个字段，中间件解析不出活动和人员，那条路由会整条返回
 * VALIDATION_ERROR。
 */
export const H5ScopedInput = z.object({ shareToken });

export const GetItineraryInput = H5ScopedInput;
