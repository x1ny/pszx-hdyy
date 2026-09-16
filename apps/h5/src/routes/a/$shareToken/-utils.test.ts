import { describe, expect, test } from "bun:test";
import {
  buildAmapNavigationHref,
  buildAppleMapsNavigationHref,
  buildBaiduMapAppHref,
  buildBaiduNavigationHref,
} from "./-utils";

const point = {
  longitude: 120.1,
  latitude: 30.2,
  name: "主会场东门",
  address: "杭州市西湖区",
  coordinateSystem: "bd09ll" as const,
  provider: "baidu" as const,
};

describe("H5 地点导航链接", () => {
  test("百度网页和原生链接都带目标坐标系与地点", () => {
    const web = new URL(buildBaiduNavigationHref(point));
    const native = new URL(buildBaiduMapAppHref(point));

    expect(web.searchParams.get("coord_type")).toBe("bd09ll");
    expect(web.searchParams.get("destination")).toContain("120.1");
    expect(web.searchParams.get("destination")).toContain("30.2");
    expect(native.protocol).toBe("baidumap:");
    expect(native.searchParams.get("coord_type")).toBe("bd09ll");
  });

  test("高德和苹果链接使用转换后的导航目标", () => {
    const amap = new URL(buildAmapNavigationHref(point));
    const apple = new URL(buildAppleMapsNavigationHref(point));

    expect(amap.searchParams.get("callnative")).toBe("1");
    expect(amap.searchParams.get("to")).toContain("主会场东门");
    expect(apple.searchParams.get("daddr")).toMatch(/^30\./);
    expect(apple.searchParams.get("dirflg")).toBe("d");
  });
});
