import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { err } from "./result";

/** 一条路由的入参声明：校验目标（json / form / param / query）+ schema。 */
export type ValidatedInput = { target: string; schema: ZodType };

/**
 * 中间件实例 → 它校验的入参。`scripts/gen-api-docs.ts` 从 `app.routes` 拿到
 * 每条路由的中间件函数后，靠这张表反查入参形状——接口文档因此是从**真正
 * 注册的路由**里读出来的，而不是照着源码另抄一份清单（抄的和跑的迟早
 * 对不上）。
 *
 * 用 WeakMap 而不是往中间件上挂属性：`jsonBody` 的返回类型必须原样保持
 * `zValidator` 推导出的样子，Hono 靠它推 `c.req.valid(...)` 和整条 `AppType`，
 * 多一个交叉类型就可能把推导搅浑。
 */
export const validatedInputs = new WeakMap<object, ValidatedInput>();

/**
 * `zValidator` 的等价替身，唯一的区别是顺手把 schema 记进 `validatedInputs`。
 *
 * **需要 json 以外的校验目标时用它，不要直接调 `zValidator`**——直接调的那条
 * 路由在生成的接口文档里会变成"入参未声明"。json 走下面的 `jsonBody` 即可，
 * 它内部就是这个。
 */
export const validate = ((...args: Parameters<typeof zValidator>) => {
  const middleware = zValidator(...args);

  // `@hono/zod-validator` 的公开签名里 schema 参数还写着 zod 3 的 `ZodSchema`，
  // 和本项目的 zod 4 `ZodType` 结构上对不上。传进来的实参本身就是 zod 4 的
  // schema（上面的调用点看得见），这里只是把类型接回去。
  validatedInputs.set(middleware, {
    target: args[0],
    schema: args[1] as unknown as ZodType,
  });

  return middleware;
}) as typeof zValidator;

// Every route validates its body the same way and fails the same way, so the
// error hook lives here instead of being copy-pasted per route. Malformed
// input is a business outcome like any other — it comes back as HTTP 200 with
// code: "VALIDATION_ERROR", not as a 400 (see shared/result.ts).
//
// Only the first issue is surfaced: these messages go straight into a toast,
// and the client already validates the same shape before submitting, so a
// full issue list would be noise. Field-level errors are the form's job.
export const jsonBody = <T extends ZodType>(schema: T) =>
  validate("json", schema, (result, c) => {
    if (!result.success) {
      return c.json(
        err({
          code: "VALIDATION_ERROR",
          message: result.error.issues[0]?.message ?? "参数不合法",
        }),
      );
    }
  });
