import { describe, expect, it } from "vitest";
import {
  batchMembersForOrganization,
  reconcileBatchScope,
  selectBatchOrganization,
  synchronizeBatchSelection,
  toggleBatchMember,
} from "./trip-batch-selection";

const options = {
  organizations: [{ id: 7 }, { id: 8 }],
  members: [
    { activityMemberId: 11, organizationId: 7 },
    { activityMemberId: 12, organizationId: 7 },
    { activityMemberId: 21, organizationId: 8 },
    { activityMemberId: 99, organizationId: null },
  ],
};

describe("trip batch selection", () => {
  it("只保留当前团体成员，null 快照不会混入任何团体", () => {
    expect(
      batchMembersForOrganization(options, 7).map(
        (member) => member.activityMemberId,
      ),
    ).toEqual([11, 12]);
    expect(batchMembersForOrganization(options, null)).toEqual([]);
  });

  it("团体变化后默认全选该团体全部合法成员", () => {
    expect(selectBatchOrganization(options, 7)).toEqual({
      organizationId: 7,
      activityMemberIds: [11, 12],
    });
  });

  it("环节范围变化时保留仍合法团体并重新全选", () => {
    const narrowed = {
      organizations: [{ id: 7 }],
      members: [{ activityMemberId: 12, organizationId: 7 }],
    };

    expect(reconcileBatchScope(7, narrowed)).toEqual({
      organizationId: 7,
      activityMemberIds: [12],
    });
  });

  it("旧团体在新环节不合法时同时清空团体和成员", () => {
    const narrowed = {
      organizations: [{ id: 8 }],
      members: [{ activityMemberId: 21, organizationId: 8 }],
    };

    expect(reconcileBatchScope(7, narrowed)).toEqual({
      organizationId: null,
      activityMemberIds: [],
    });
  });

  it("同范围刷新只剔除失效成员，不恢复用户已取消的人", () => {
    expect(
      synchronizeBatchSelection(
        { organizationId: 7, activityMemberIds: [11] },
        options,
      ),
    ).toEqual({ organizationId: 7, activityMemberIds: [11] });
  });

  it("逐人勾选保持服务端候选顺序", () => {
    const eligible = batchMembersForOrganization(options, 7);
    expect(toggleBatchMember([12], 11, true, eligible)).toEqual([11, 12]);
    expect(toggleBatchMember([11, 12], 11, false, eligible)).toEqual([12]);
  });
});
