import { describe, expect, test } from "bun:test";
import type { AgendaItem, Car } from "../-queries";
import { associateCarsWithVisibleAgenda } from "./schedule-list";

const car = (id: number, segmentIds: number[]) => ({ id, segmentIds }) as Car;

describe("用车与可见议程关联", () => {
  const agenda = [{ id: 10 }, { id: 20 }] as AgendaItem[];

  test("关联到可见环节的用车归入环节，不再作为独立日程", () => {
    const result = associateCarsWithVisibleAgenda(agenda, [car(1, [10])]);

    expect(result.carsBySegment.get(10)?.map((row) => row.id)).toEqual([1]);
    expect(result.standaloneCars).toEqual([]);
  });

  test("同一辆车关联多个可见环节时分别展示，重复关联 id 不重复渲染", () => {
    const result = associateCarsWithVisibleAgenda(agenda, [
      car(1, [10, 10, 20]),
    ]);

    expect(result.carsBySegment.get(10)?.map((row) => row.id)).toEqual([1]);
    expect(result.carsBySegment.get(20)?.map((row) => row.id)).toEqual([1]);
  });

  test("没有关联或只关联到不可见环节时保留独立展示", () => {
    const result = associateCarsWithVisibleAgenda(agenda, [
      car(1, []),
      car(2, [99]),
    ]);

    expect(result.carsBySegment.size).toBe(0);
    expect(result.standaloneCars.map((row) => row.id)).toEqual([1, 2]);
  });
});
