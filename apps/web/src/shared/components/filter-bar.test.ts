import { describe, expect, it } from "vitest";
import { isSameFilter } from "./filter-bar";

type Filter = {
  name?: string;
  status?: string;
  page?: number;
  voided?: boolean;
};

const same = (a: Filter, b: Filter) => isSameFilter(a, b);

describe("isSameFilter", () => {
  it("条件一样就算等价，字段顺序不影响", () => {
    const a = { name: "张三", status: "enabled", page: 1 };
    const b = { status: "enabled", page: 1, name: "张三" };
    expect(same(a, b)).toBe(true);
  });

  it("任何一个字段变了都不等价", () => {
    expect(same({ name: "张三" }, { name: "李四" })).toBe(false);
    expect(same({ page: 1 }, { page: 2 })).toBe(false);
    expect(same({ voided: false }, { voided: true })).toBe(false);
  });

  it("缺字段和字段为 undefined 是同一件事，都表示不筛这一项", () => {
    expect(same({ name: "张三" }, { name: "张三", status: undefined })).toBe(
      true,
    );
  });

  it("清掉一个条件不算等价", () => {
    expect(same({ status: "enabled" }, { status: undefined })).toBe(false);
  });
});
