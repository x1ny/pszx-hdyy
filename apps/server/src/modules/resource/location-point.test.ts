import { describe, expect, test } from "bun:test";
import { LocationPointSchema } from "./location-point";
import { UpdateResourceInput } from "./validation";

const point = {
  longitude: 120.1,
  latitude: 30.2,
  name: "集合入口",
  address: "杭州市",
  coordinateSystem: "bd09ll" as const,
  provider: "baidu" as const,
};
const resource = {
  id: 1,
  resourceType: "transport",
  transportScene: "pickup",
  name: "接驳车",
};

describe("资源地图定位", () => {
  test("成组保存坐标，区分旧客户端省略和显式清除", () => {
    expect(UpdateResourceInput.parse(resource).locationPoint).toBeUndefined();
    expect(
      UpdateResourceInput.parse({ ...resource, locationPoint: null })
        .locationPoint,
    ).toBeNull();
    expect(
      UpdateResourceInput.parse({ ...resource, locationPoint: point })
        .locationPoint,
    ).toEqual(point);
  });

  test("拒绝缺项、非法数值和混用坐标系", () => {
    for (const changes of [
      { latitude: undefined },
      { longitude: 181 },
      { latitude: -91 },
      { longitude: Number.NaN },
      { latitude: Number.POSITIVE_INFINITY },
      { coordinateSystem: "gcj02" },
      { provider: "amap" },
      { name: "  " },
    ]) {
      expect(
        LocationPointSchema.safeParse({ ...point, ...changes }).success,
      ).toBe(false);
    }
  });
});
