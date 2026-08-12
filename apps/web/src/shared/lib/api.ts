import { hcWithType } from "@repo/server/client-type";

// Type-only import chain: nothing from apps/server is bundled here.
// In dev the base URL is this origin and Vite proxies /api to apps/server;
// set VITE_API_URL when the two are deployed to different domains.
const baseUrl = import.meta.env.VITE_API_URL ?? window.location.origin;

export const api = hcWithType(baseUrl, {
  init: { credentials: "include" },
});

/**
 * 从某个接口的响应联合类型里取出成功分支的 `data`。
 *
 * hc 推出来的类型是整个信封的联合（`{code:"OK",data} | {code:"NOT_FOUND",message}`），
 * 页面想要的只有 data。有了它，业务侧写 `ApiData<InferResponseType<typeof …>>`
 * 就能拿到干净的领域类型，不用手抄一份 `type Supplier = {...}`。
 */
export type ApiData<T> = Extract<T, { code: "OK" }> extends { data: infer D }
  ? D
  : never;

/** 业务失败。带着 `code` 是为了让调用方能分支处理（比如 NOT_FOUND 要刷新列表）。 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 拆信封：`{code:"OK", data}` 取出 data，其余一律抛 `ApiError`。
 *
 * 为什么统一走「抛异常」而不是把 code 传给页面：react-query 的
 * loading / error / retry 全建立在 Promise 拒绝之上，返回一个「成功的失败值」
 * 会让 `isError` 永远是 false，每个页面都得自己写一遍分支。
 *
 * 注意必须在**运行时**判断 code，不能靠类型穷举 —— requireUser 中间件返回的
 * UNAUTHORIZED 不会出现在 hc 推导的响应类型里（Hono 只合并 handler 的返回）。
 */
/**
 * 取出一个响应对象 `json()` 的结果类型。
 *
 * 必须是**条件类型**而不是直接写成参数上的 `Promise<{json: () => Promise<T>}>`：
 * hc 的 `$post()` 返回的是 `ClientResponse<成功> | ClientResponse<失败>` 这种
 * **联合**，直接推 T 会逼 TS 挑其中一个分支，然后另一个分支就不兼容了。
 * 条件类型会在联合上分发，最后得到「成功 | 失败」的联合，正是 ApiData 要的输入。
 */
type JsonBody<R> = R extends { json: () => Promise<infer T> } ? T : never;

export async function unwrap<R extends { json: () => Promise<unknown> }>(
  request: Promise<R>,
): Promise<ApiData<JsonBody<R>>> {
  const response = await request;
  // 一次性收口的类型断言：信封的形状由 shared/result.ts 保证，
  // 这里断言一次，业务侧就再也不用 as 了。
  const result = (await response.json()) as {
    code: string;
    message?: string;
    data?: unknown;
  };

  if (result.code !== "OK") {
    throw new ApiError(result.code, result.message ?? "请求失败");
  }

  return result.data as ApiData<JsonBody<R>>;
}
