import { describe, expect, test } from "bun:test";
import { routes as app } from "../../index";

/**
 * 盯着 index.ts 里那道"关闭自助注册"的中间件。
 *
 * **它防的是顺序被改坏，而不是某个函数算错。** 那道拦截必须注册在
 * `app.route("/", authHandler)` **之前**——Hono 按注册顺序匹配，一旦有人把
 * authHandler 挪到前面，Better Auth 就重新接管了 `/api/auth/*`，注册接口会**静
 * 悄悄地重新开放**：没有报错、没有类型错误，只有公网上多出一个建号入口。
 *
 * 这类"改坏了也不报错"的约束，只能靠一条测试盯着。
 *
 * 不连库：被拒的响应在任何数据库访问之前就返回了，所以这个文件可以在没有
 * DATABASE_URL 的环境里跑（`pg` 的 Pool 是懒连接的）。
 */
describe("自助注册已关闭", () => {
  test("POST /api/auth/sign-up/email 被拒绝", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "outsider@example.com",
        password: "hunter2hunter2",
        name: "外部人员",
      }),
    });

    // 业务失败也是 HTTP 200，结果只由 code 表达（见 AGENTS.md 的前后端边界）。
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("换个子路径也拦得住", async () => {
    // 通配 `/api/auth/sign-up/*` 而不是只写 email 那一条：Better Auth 的注册端点
    // 随插件增加（social、phone…），逐条列举迟早漏一个。
    const res = await app.request("/api/auth/sign-up/anything", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("拦截范围只覆盖 sign-up，没有误伤登录", () => {
    // 读注册表而不是真发一个登录请求：后者会走到 Better Auth 里去查库，这个文件
    // 就跑不了了。而要防的东西（匹配模式被放宽成 `/api/auth/sign-*`，把登录一起
    // 挂掉）在路由表上看得一样清楚。
    const ours = app.routes.filter(
      (route) =>
        route.path.startsWith("/api/auth/") && route.path !== "/api/auth/*",
    );

    expect(ours.length).toBeGreaterThan(0);
    for (const route of ours) {
      expect(route.path).toBe("/api/auth/sign-up/*");
    }
  });
});
