import { describe, expect, it } from "vitest";
import {
  formatOrganizationBatchSummary,
  getOrganizationConflictDetails,
  initializeOrganizationSelection,
  reconcileOrganizationSelection,
  toggleOrganizationPageSelection,
  toggleOrganizationSelection,
} from "./member-picker-state";

describe("organization member picker state", () => {
  it("选择团体后默认勾选全部合法候选，并排除当前范围人员", () => {
    expect([...initializeOrganizationSelection([1, 2, 3, 4], [2, 4])]).toEqual([
      1, 3,
    ]);
  });

  it("支持逐人取消、当前页全选，并在范围快照刷新后剔除已加入人员", () => {
    const initial = initializeOrganizationSelection([1, 2, 3], []);
    const deselected = toggleOrganizationSelection(initial, 2);
    expect([...deselected]).toEqual([1, 3]);

    const pageSelected = toggleOrganizationPageSelection(
      deselected,
      [2, 4],
      true,
    );
    expect([...pageSelected]).toEqual([1, 3, 2, 4]);
    expect([...reconcileOrganizationSelection(pageSelected, [1, 4])]).toEqual([
      3, 2,
    ]);
  });

  it("完整汇总新增、已存在、跳过和逐层冲突明细", () => {
    const result = {
      organizationId: 7,
      targetLayer: "segment" as const,
      added: 2,
      existing: 1,
      skipped: 1,
      conflict: 2,
      items: [
        {
          memberId: 11,
          name: "林一",
          outcome: "skipped" as const,
          filledLayers: [],
          conflicts: [
            {
              layer: "project" as const,
              relationId: 1,
              existingOrganizationId: 3,
            },
            {
              layer: "activity" as const,
              relationId: 2,
              existingOrganizationId: 3,
            },
          ],
        },
      ],
    };

    expect(formatOrganizationBatchSummary(result)).toBe(
      "处理完成：新增 2 人，已存在 1 人，跳过 1 人，发现 2 条冲突",
    );
    expect(getOrganizationConflictDetails(result)).toEqual([
      "林一：项目、活动已有其他团体快照",
    ]);
  });
});
