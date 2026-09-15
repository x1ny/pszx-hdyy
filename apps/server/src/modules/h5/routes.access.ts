import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import {
  H5_COOKIE_NAME,
  resolveActivityMember,
  resolveH5Activity,
  setH5Cookie,
} from "./auth";
import { SubmitPhoneInput } from "./validation";

/**
 * h5 的访问入口接口：提交手机号和退出查看都不要求已验证。
 *
 * 它另占一个前缀而不是挤进 `/api/h5`，是因为那个前缀整体挂着
 * `requireH5Member`（见 auth.ts）—— 前缀即作用域，这样新增 h5 接口时默认受
 * 保护，不会因为忘了挂守卫而裸奔。代价是访问入口得单独放一个前缀，值得。
 */
export const h5AccessRoutes = new Hono()
  /**
   * 校验手机号，通过就把它写进 7 天的 HttpOnly cookie。
   *
   * 手机号本身就是凭证，所以这里既是"登录"也是唯一一次校验入口。返回姓名是
   * 给前端做过渡文案用的，页面稍后会从行程接口再拿一次权威值。
   */
  .post("/submitPhone", jsonBody(SubmitPhoneInput), async (c) => {
    const { shareToken, mobile } = c.req.valid("json");

    // 这里**没有** publishStatus / displayEnabled 的过滤，是产品决定的：随机
    // 分享 token 只是隐藏连续 id 的公开地址，不替代展示开关。代价是管理端的
    // "H5 展示"开关目前没有任何读取方 —— 运营关掉它，已分享的链接照常展示。
    // 这不是漏了；要收紧就在 resolveH5Activity 的查询里加条件。
    const found = await resolveH5Activity(shareToken);

    if (!found) {
      return c.json(
        err({ code: "NOT_FOUND", message: "活动不存在或链接已失效" }),
      );
    }

    const memberRow = await resolveActivityMember(found.id, mobile);
    if (!memberRow) {
      // 号不存在 / 不在本活动 / 已被禁用，一律同一句话。区分了会把"这个号在不在
      // 系统里"变成可探测信号，而三种情况对用户的下一步动作完全一样（找主办方）。
      return c.json(
        err({
          code: "H5_UNAUTHORIZED",
          message: "未查到您在本活动的参会信息",
        }),
      );
    }

    setH5Cookie(c, mobile);

    return c.json(ok({ name: memberRow.name }));
  })
  /**
   * 退出查看。cookie 是 HttpOnly，不能由浏览器脚本删除，必须由服务端下发过期
   * 指令；不要求 shareToken，这样即使活动链接已失效也能清掉当前访问凭证。
   */
  .post("/logout", (c) => {
    deleteCookie(c, H5_COOKIE_NAME, {
      path: "/",
      secure: c.req.url.startsWith("https://"),
    });
    return c.json(ok(null));
  });
