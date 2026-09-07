// The one shared vocabulary every module returns through. HTTP status stays
// 200 for both success and defined business outcomes — "code" carries the
// business state, not the status line. Real non-200s are reserved for
// things that aren't business outcomes at all: malformed request bodies
// (zValidator's error hook) and uncaught exceptions (index.ts's onError).
export type ApiError =
  | { code: "UNAUTHORIZED"; message: string }
  // 已登录，但角色没有这个模块的权限点。**和 UNAUTHORIZED 分开**是因为前端要
  // 分两种处理：UNAUTHORIZED 该把人踢回登录页，FORBIDDEN 踢回去只会让他重新
  // 登录一次再撞同一堵墙——那是配置问题，得让他看见"没有权限"这四个字。
  | { code: "FORBIDDEN"; message: string }
  // `path` 是可选的字段定位，给**一次提交里含多个区块**的接口用（目前只有
  // agenda 的 saveSegmentConfig）：环节配置页一屏四块、可能滚很长，一句
  // "保存失败" 用户找不到是哪一格错了。单字段接口不用填，前端也不必处理。
  | { code: "VALIDATION_ERROR"; message: string; path?: string }
  | { code: "NOT_FOUND"; message: string }
  // h5 公众端未通过手机号校验。**刻意和 UNAUTHORIZED 分开**，不是为了区分
  // 措辞，是因为它要多带一个 `maskedMobile`：cookie 是 HttpOnly 的，前端读不到
  // 自己当前用的是哪个号，"当前 138****8888 不在本活动名单，请换一个号码"
  // 这句话只能由服务端给。把这个字段挂到管理端也在用的 UNAUTHORIZED 上，
  // 等于让每个后台接口的错误类型都多一个它永远不会填的字段。
  | { code: "H5_UNAUTHORIZED"; message: string; maskedMobile?: string }
  | { code: "INTERNAL_ERROR"; message: string };

export type ApiOk<T> = { code: "OK"; data: T };

/** 信封的完整形状。描述用；具体接口的返回类型由下面两个函数各自推导。 */
export type ApiResult<T> = ApiOk<T> | ApiError;

// ⚠️ 这两个函数**故意不标注成 `ApiResult<T>`**。
//
// 标成 ApiResult<T> 的话，`c.json(ok(row))` 的响应类型就变成了「OK 分支 ∪ 全部
// 四种错误」，哪怕这个接口根本不会返回 UNAUTHORIZED。后果有两个：
//   1. 客户端 `Extract<响应类型, { code: "OK" }>` 取不回精确的 data —— 成功分支
//      被同一个联合里的其他成员糊住，前端只能自己手抄一份领域类型；
//   2. 前端做错误分支时要处理一堆这个接口压根不会给的 code。
//
// 让返回类型自然推导，`c.json(ok(row))` 就是 `{code:"OK"; data: Row}`，
// 路由级的联合正好等于**这个接口真正可能返回的东西**。
export const ok = <T>(data: T) => ({ code: "OK" as const, data });

export const err = <E extends ApiError>(error: E) => error;
