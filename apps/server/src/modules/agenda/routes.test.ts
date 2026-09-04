import { describe, expect, test } from "bun:test";
import {
  listSegmentConfigResourceBindingsQuery,
  listSegmentConfigResourcesQuery,
} from "./routes";

describe("环节配置资源读取", () => {
  const resources = listSegmentConfigResourcesQuery([7]).toSQL();
  const bindings = listSegmentConfigResourceBindingsQuery([7]).toSQL();

  test("资源安排只读取有效资源，作废后保留关联但不再展示", () => {
    expect(resources.sql).toContain('"activity_resource"."status" = $1');
    expect(resources.params).toContain("active");
  });

  test("绑定名单同样排除作废资源", () => {
    expect(bindings.sql).toContain('"activity_resource"."status" = $1');
    expect(bindings.params).toContain("active");
  });
});
