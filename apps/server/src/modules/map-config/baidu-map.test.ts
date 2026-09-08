import { afterEach, describe, expect, test } from "bun:test";
import { getBaiduMapAk } from "./baidu-map";

const originalAk = process.env.BAIDU_MAP_AK;

afterEach(() => {
  if (originalAk === undefined) delete process.env.BAIDU_MAP_AK;
  else process.env.BAIDU_MAP_AK = originalAk;
});

describe("getBaiduMapAk", () => {
  test("读取运行时环境变量并去除首尾空白", () => {
    process.env.BAIDU_MAP_AK = "  browser-ak  ";
    expect(getBaiduMapAk()).toBe("browser-ak");
  });

  test("未配置时返回空字符串", () => {
    delete process.env.BAIDU_MAP_AK;
    expect(getBaiduMapAk()).toBe("");
  });
});
