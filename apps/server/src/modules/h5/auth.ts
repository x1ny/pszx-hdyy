import { and, asc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { db } from "../../infra/db";
import { err } from "../../shared/result";
import { activityMember, member } from "../member/schema";

/**
 * h5 公众端的身份。**这不是 Better Auth，两套身份体系完全独立。**
 *
 * 凭证就是手机号本身 —— 没有 token、没有验证码。它挡不住"知道号码的人就能
 * 看"，这是明确接受的底线（活动分享链接本来就会被转发）。它挡住的是"光有
 * 链接、不知道任何号码"的人。
 *
 * 手机号存在 **HttpOnly cookie** 里而不是走每个接口的 body，有三个理由：
 *   1. 业务 handler 里不会再出现一遍"解析手机号 + 判空"，漏写一处就是一个
 *      静默的无凭证接口；
 *   2. JS 读不到它，共享设备 / XSS 捞不走；
 *   3. **换成真登录时只有这个文件要改** —— 服务端把 cookie 内容从手机号换成
 *      签发的 token、下面这个中间件改读它即可，业务路由和前端调用点零改动。
 *
 * cookie 名必须显式避开 Better Auth：**cookie 不按端口隔离**，管理端（80）和
 * h5（81）在浏览器眼里共用一个 cookie jar，重名会互相覆盖（见 docker/README.md）。
 */
export const H5_COOKIE_NAME = "h5_guest";

/** 7 天。到点浏览器自己删，代码里不需要任何过期判断。 */
export const H5_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export type H5Member = {
  activityMemberId: number;
  memberId: number;
  name: string;
};

export type H5Variables = { h5Member: H5Member };

/** `138****8888`。和管理端 member/-utils.ts 的 maskPhone 同一个形状。 */
export const maskMobile = (mobile: string) =>
  mobile.length < 7 ? mobile : `${mobile.slice(0, 3)}****${mobile.slice(-4)}`;

export function setH5Cookie(c: Context, mobile: string) {
  setCookie(c, H5_COOKIE_NAME, mobile, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: H5_COOKIE_MAX_AGE,
    // TLS 由反代终结时这里看到的仍是 http，那种部署下 Secure 标记会缺失 ——
    // 缺失不影响功能，加错了才会让 cookie 在开发环境（http）直接被浏览器丢掉。
    secure: c.req.url.startsWith("https://"),
  });
}

/**
 * 手机号 → 本活动的人员关系。
 *
 * **同一手机号可能对应多个 member**（主档上 mobile 没有唯一约束，schema 注释
 * 里的 R-002 明确写着不唯一），这里的口径是**取第一条**。排序键固定成
 * `activity_member.id` 升序不是可有可无的细节：不给 ORDER BY 的话 Postgres
 * 不保证顺序，同一个人两次请求可能命中不同的人。
 *
 * 已知代价：共用一个联系电话的两个人，后登记的那位永远看到前一位的行程，
 * 系统不报错。页面顶部会显示命中的姓名，是这个方案里唯一的补救。
 *
 * 禁用的人当作查不到 —— 禁用的语义就是不该再有访问，哪怕关系还在。
 */
export const resolveActivityMemberQuery = (
  activityId: number,
  mobile: string,
) =>
  db
    .select({
      activityMemberId: activityMember.id,
      memberId: activityMember.memberId,
      name: member.name,
    })
    .from(activityMember)
    .innerJoin(member, eq(member.id, activityMember.memberId))
    .where(
      and(
        // 这一条就是"拿 A 活动的凭证打不开 B 活动"的全部实现 —— cookie 里只有
        // 手机号，活动范围完全由这里决定。
        eq(activityMember.activityId, activityId),
        eq(member.mobile, mobile),
        eq(member.status, "enabled"),
      ),
    )
    .orderBy(asc(activityMember.id))
    .limit(1);

export async function resolveActivityMember(
  activityId: number,
  mobile: string,
): Promise<H5Member | null> {
  const [row] = await resolveActivityMemberQuery(activityId, mobile);
  return row ?? null;
}

/**
 * body 里的 activityId。
 *
 * `HonoRequest` 缓存解析后的 body，所以这里读一次不影响后面 `zValidator`
 * 再读一次 —— 两者拿到同一个对象。这份依赖是有意的：把 activityId 的解析
 * 收在中间件里，业务 handler 才不需要各自再写一遍"这个人是不是这个活动的"。
 * 万一缓存行为变了，表现是**每个 h5 请求都失败**，响亮且立刻发现。
 */
async function readActivityId(c: Context): Promise<number | null> {
  const body = (await c.req.json().catch(() => null)) as {
    activityId?: unknown;
  } | null;
  const raw = body?.activityId;
  const id = typeof raw === "string" ? Number(raw) : raw;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 挂在 `/api/h5` **整个前缀**上（照 `file` 模块那个先例：`.use()` 的作用域就是
 * 模块自己的前缀）。这样新增 h5 接口时**默认就是受保护的**，不存在"忘了挂守卫"
 * 这种静默漏洞。
 *
 * 不需要登录的那一个接口（提交手机号）另占 `/api/h5Access` 前缀，见
 * routes.access.ts。
 */
export const requireH5Member = createMiddleware<{ Variables: H5Variables }>(
  async (c, next) => {
    const mobile = getCookie(c, H5_COOKIE_NAME);
    if (!mobile) {
      return c.json(
        err({ code: "H5_UNAUTHORIZED", message: "请先验证手机号" }),
      );
    }

    const activityId = await readActivityId(c);
    if (activityId === null) {
      return c.json(
        err({ code: "VALIDATION_ERROR", message: "缺少 activityId" }),
      );
    }

    const found = await resolveActivityMember(activityId, mobile);
    if (!found) {
      // 回传脱敏号码，前端才能把话说具体："当前 138****8888 不在本活动名单"。
      // 前端读不到 HttpOnly cookie，这句话只能由服务端给。
      return c.json(
        err({
          code: "H5_UNAUTHORIZED",
          message: "未查到您在本活动的参会信息",
          maskedMobile: maskMobile(mobile),
        }),
      );
    }

    c.set("h5Member", found);
    await next();
  },
);
