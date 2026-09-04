import { hcWithType } from "@repo/server/client-type";

// 纯类型 import 链：apps/server 的任何代码都不会被打进这个包。
// h5 和 API 在生产形态下同源（同一个 Hono 的同一个端口），开发时靠 Vite 的
// /api 代理拉回同源，所以 base URL 永远是当前 origin，不需要 VITE_API_URL。
export const api = hcWithType(window.location.origin, {
  init: { credentials: "include" },
});

/**
 * 从某个接口的响应联合类型里取出成功分支的 `data`。
 *
 * hc 推出来的是整个信封的联合（`{code:"OK",data} | {code:"NOT_FOUND",message}`），
 * 页面要的只有 data。有了它，业务侧写 `ApiData<InferResponseType<typeof …>>`
 * 就能拿到干净的领域类型，不用手抄一份。
 */
export type ApiData<T> =
  Extract<T, { code: "OK" }> extends { data: infer D } ? D : never;

/** 未通过手机号校验。路由守卫靠这个 code 决定跳不跳手机号页。 */
export const H5_UNAUTHORIZED = "H5_UNAUTHORIZED";

/**
 * 业务失败。
 *
 * `maskedMobile` 只有 `H5_UNAUTHORIZED` 会带：手机号存在 **HttpOnly cookie**
 * 里，JS 读不到，所以"当前 138****8888 不在本活动名单"这句话只能由服务端把
 * 脱敏后的号码回传过来。没有它，换号那一步就只能说一句干巴巴的"验证失败"。
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly maskedMobile?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 取出一个响应对象 `json()` 的结果类型。
 *
 * 必须是**条件类型**而不是直接写在参数上：hc 的 `$post()` 返回的是
 * `ClientResponse<成功> | ClientResponse<失败>` 这种**联合**，直接推 T 会逼 TS
 * 挑其中一个分支，另一个就不兼容了。条件类型在联合上分发，最后得到
 * 「成功 | 失败」的联合，正是 ApiData 要的输入。
 */
type JsonBody<R> = R extends { json: () => Promise<infer T> } ? T : never;

/**
 * 拆信封：`{code:"OK", data}` 取出 data，其余一律抛 `ApiError`。
 *
 * 统一走抛异常而不是把 code 交给页面：react-query 的 loading / error / retry
 * 全建立在 Promise 拒绝之上，返回一个"成功的失败值"会让 `isError` 永远是
 * false，每个页面都得自己写一遍分支。
 *
 * 必须在**运行时**判断 code —— 中间件返回的 H5_UNAUTHORIZED 不会出现在 hc 推导
 * 的响应类型里（Hono 只把 handler 的返回并进 AppType）。
 */
export async function unwrap<R extends { json: () => Promise<unknown> }>(
  request: Promise<R>,
): Promise<ApiData<JsonBody<R>>> {
  const response = await request;
  // 一次性收口的类型断言：信封的形状由服务端 shared/result.ts 保证，
  // 这里断言一次，业务侧就再也不用 as 了。
  const result = (await response.json()) as {
    code: string;
    message?: string;
    maskedMobile?: string;
    data?: unknown;
  };

  if (result.code !== "OK") {
    throw new ApiError(
      result.code,
      result.message ?? "请求失败",
      result.maskedMobile,
    );
  }

  return result.data as ApiData<JsonBody<R>>;
}
