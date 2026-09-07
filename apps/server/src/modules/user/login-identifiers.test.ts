import { describe, expect, test } from "bun:test";
import { routes as app } from "../../index";
import {
  isPlaceholderEmail,
  toDisplayEmail,
  toStoredEmail,
} from "../../shared/placeholder-email";

/**
 * 登录标识有两条路：账号（`/sign-in/username`）和邮箱（`/sign-in/email`）。
 * 邮箱那条是为**关闭自助注册之前建的老账号**留的——它们没有 username，但邮箱和
 * 密码都完好。
 *
 * 这里盯的是那条路上唯一的闸：占位邮箱不能用来登录。
 */
describe("占位邮箱不能当登录标识", () => {
  test("`hooks.before` 在查库之前就拒掉", async () => {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "zhangsan@local.invalid",
        password: "whatever12345",
      }),
    });

    expect(res.status).toBe(401);

    // 错误码必须和"邮箱不存在/密码不对"完全一样。换一个专属的码（比如
    // PLACEHOLDER_EMAIL）等于告诉试探的人"这个账号存在，只是没填邮箱"。
    expect(await res.json()).toMatchObject({
      code: "INVALID_EMAIL_OR_PASSWORD",
    });
  });

  // 「真实邮箱不被这道闸拦住」故意**不**在端点层面测：那条路径会真的去查库，在没有
  // DATABASE_URL 的测试环境里会吐一整段 SASL 连接失败的栈。测试照样是绿的，但那段
  // 噪音会盖住以后真正的报错。同一件事由下面 isPlaceholderEmail 的纯函数用例覆盖，
  // 而这里第一条已经证明了钩子确实挂上了。
});

describe("占位邮箱的三个函数", () => {
  test("没填邮箱时按账号名派生，账号名归一成小写", () => {
    expect(toStoredEmail(undefined, "ZhangSan")).toBe("zhangsan@local.invalid");
  });

  test("填了邮箱就原样存", () => {
    expect(toStoredEmail("a@b.com", "zhangsan")).toBe("a@b.com");
  });

  test("读出来时占位值一律呈现为空", () => {
    expect(toDisplayEmail("zhangsan@local.invalid")).toBeNull();
    expect(toDisplayEmail("a@b.com")).toBe("a@b.com");
    expect(toDisplayEmail(null)).toBeNull();
  });

  test("识别占位值时忽略大小写和首尾空格", () => {
    // 登录表单会把用户输入原样发过来，大小写和空格都不可控。
    expect(isPlaceholderEmail("  ZhangSan@LOCAL.Invalid  ")).toBe(true);
    expect(isPlaceholderEmail("a@b.com")).toBe(false);
    // 不能只判包含：这是个真实可投递地址，不该被拦。
    expect(isPlaceholderEmail("local.invalid@example.com")).toBe(false);
  });
});
