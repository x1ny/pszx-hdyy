import { describe, expect, test } from "bun:test";
import { isLoopbackAddress, safeRedirectTarget } from "./routes.dev";

const BACKSLASH_TARGET = `/${String.fromCharCode(92)}evil.example`;

describe("safeRedirectTarget", () => {
  test("放行站内路径并保留 query 和 hash", () => {
    expect(safeRedirectTarget("/project/1")).toBe("/project/1");
    expect(safeRedirectTarget("/member?page=3#top")).toBe("/member?page=3#top");
  });

  test("挡掉协议相对地址", () => {
    expect(safeRedirectTarget("//evil.example")).toBe("/");
  });

  test("挡掉反斜杠形式的外站跳转", () => {
    // URL 标准把反斜杠当路径分隔符，所以这个值会解析到外站 origin。
    // 只判断开头的 "/" 和 "//" 拦不住它 —— 这正是之前的实现漏掉的。
    expect(safeRedirectTarget(BACKSLASH_TARGET)).toBe("/");
  });

  test("百分号编码的反斜杠解码后同样被挡住", () => {
    // Hono 的 c.req.query() 会解码，所以真正到达这个函数的就是上面那种
    // 字面反斜杠。把解码这一步显式写出来，免得有人以为编码形式能绕过去。
    expect(decodeURIComponent("/%5Cevil.example")).toBe(BACKSLASH_TARGET);
    expect(safeRedirectTarget(decodeURIComponent("/%5Cevil.example"))).toBe(
      "/",
    );
  });

  test("未解码的 %5C 停留在同源，不构成跳转", () => {
    // 记录真实行为而不是想当然：百分号编码的反斜杠在路径里不是分隔符，
    // 浏览器解析它仍然落在本站，所以原样返回是安全的。
    expect(safeRedirectTarget("/%5Cevil.example")).toBe("/%5Cevil.example");
  });

  test("挡掉绝对地址和非 http 协议", () => {
    expect(safeRedirectTarget("http://evil.example/x")).toBe("/");
    expect(safeRedirectTarget("javascript:alert(1)")).toBe("/");
  });

  test("空值回落到首页", () => {
    expect(safeRedirectTarget(undefined)).toBe("/");
    expect(safeRedirectTarget("")).toBe("/");
  });
});

describe("isLoopbackAddress", () => {
  test("认回环地址的三种写法", () => {
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopbackAddress(address)).toBe(true);
    }
  });

  test("拒绝局域网地址和空值", () => {
    for (const address of [
      "10.2.1.137",
      "192.168.1.5",
      "172.18.0.1",
      undefined,
    ]) {
      expect(isLoopbackAddress(address)).toBe(false);
    }
  });
});
