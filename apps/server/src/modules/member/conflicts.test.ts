import { describe, expect, test } from "bun:test";
import { findMemberTimeConflicts, type SegmentAttendance } from "./conflicts";

// 冲突判定是这个模块唯一不连库就能验的算法，用例全部写成字面时间。

const attend = (
  memberId: number,
  segmentId: number,
  start: string,
  end: string,
): SegmentAttendance => ({
  memberId,
  memberName: `人员 ${memberId}`,
  segmentId,
  segmentName: `环节 ${segmentId}`,
  startTime: new Date(start),
  endTime: new Date(end),
});

/** 断言用的紧凑形状：谁 + 哪两个环节。 */
const pairs = (rows: SegmentAttendance[]) =>
  findMemberTimeConflicts(rows).map((conflict) => [
    conflict.memberId,
    conflict.segments[0].id,
    conflict.segments[1].id,
  ]);

describe("findMemberTimeConflicts", () => {
  test("同一个人两个环节时间重叠时报一处冲突", () => {
    expect(
      pairs([
        attend(1, 10, "2026-09-18 11:00", "2026-09-18 12:00"),
        attend(1, 11, "2026-09-18 11:30", "2026-09-18 12:30"),
      ]),
    ).toEqual([[1, 10, 11]]);
  });

  test("不同人各自参加重叠环节不算冲突", () => {
    expect(
      pairs([
        attend(1, 10, "2026-09-18 11:00", "2026-09-18 12:00"),
        attend(2, 11, "2026-09-18 11:30", "2026-09-18 12:30"),
      ]),
    ).toEqual([]);
  });

  test("首尾相接不算重叠——半开区间 [start, end)", () => {
    expect(
      pairs([
        attend(1, 10, "2026-09-18 11:00", "2026-09-18 12:00"),
        attend(1, 11, "2026-09-18 12:00", "2026-09-18 13:00"),
      ]),
    ).toEqual([]);
  });

  test("零时长环节不占时间段，谁都不冲突", () => {
    const inside = attend(1, 11, "2026-09-18 11:30", "2026-09-18 11:30");
    const atStart = attend(1, 12, "2026-09-18 11:00", "2026-09-18 11:00");
    const host = attend(1, 10, "2026-09-18 11:00", "2026-09-18 12:00");

    // 卡在正中间的：按半开区间它落在 [11:00, 12:00) 里，算冲突。
    expect(pairs([host, inside])).toEqual([[1, 10, 11]]);
    // 卡在开始那一刻的：earlier.start < later.end 不成立，不算冲突。这一条
    // 是纯粹靠 later.endTime <= earlier.startTime 那个补判兜住的。
    expect(pairs([host, atStart])).toEqual([]);
  });

  test("包含关系算冲突", () => {
    expect(
      pairs([
        attend(1, 10, "2026-09-18 09:00", "2026-09-18 18:00"),
        attend(1, 11, "2026-09-18 11:00", "2026-09-18 12:00"),
      ]),
    ).toEqual([[1, 10, 11]]);
  });

  test("三个环节两两重叠时报三对，不是聚成一条", () => {
    expect(
      pairs([
        attend(1, 10, "2026-09-18 11:00", "2026-09-18 13:00"),
        attend(1, 11, "2026-09-18 11:30", "2026-09-18 13:30"),
        attend(1, 12, "2026-09-18 12:00", "2026-09-18 14:00"),
      ]),
    ).toEqual([
      [1, 10, 11],
      [1, 10, 12],
      [1, 11, 12],
    ]);
  });

  test("A∩B、B∩C 但 A∩C 不相交时只报两对", () => {
    expect(
      pairs([
        attend(1, 10, "2026-09-18 11:00", "2026-09-18 12:00"),
        attend(1, 11, "2026-09-18 11:30", "2026-09-18 13:00"),
        attend(1, 12, "2026-09-18 12:30", "2026-09-18 14:00"),
      ]),
    ).toEqual([
      [1, 10, 11],
      [1, 11, 12],
    ]);
  });

  test("每对只出现一次，且两个环节按开始时间排", () => {
    // 故意让 id 顺序和时间顺序相反，确保排序看的是时间不是 id。
    const [conflict] = findMemberTimeConflicts([
      attend(1, 20, "2026-09-18 11:30", "2026-09-18 12:30"),
      attend(1, 10, "2026-09-18 11:00", "2026-09-18 12:00"),
    ]);
    expect(conflict.segments.map((segment) => segment.id)).toEqual([10, 20]);
  });

  test("输出顺序与输入顺序无关，按最早开始时间排", () => {
    const rows = [
      attend(2, 20, "2026-09-18 15:00", "2026-09-18 16:00"),
      attend(2, 21, "2026-09-18 15:30", "2026-09-18 16:30"),
      attend(1, 10, "2026-09-18 09:00", "2026-09-18 10:00"),
      attend(1, 11, "2026-09-18 09:30", "2026-09-18 10:30"),
    ];
    expect(pairs(rows)).toEqual([
      [1, 10, 11],
      [2, 20, 21],
    ]);
    expect(pairs([...rows].reverse())).toEqual([
      [1, 10, 11],
      [2, 20, 21],
    ]);
  });

  test("没有重叠时返回空数组", () => {
    expect(
      pairs([
        attend(1, 10, "2026-09-18 09:00", "2026-09-18 10:00"),
        attend(1, 11, "2026-09-18 14:00", "2026-09-18 15:00"),
      ]),
    ).toEqual([]);
  });
});
