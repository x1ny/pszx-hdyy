import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { refreshActivityMemberOrderingQueries } from "#/features/member/relation-queries.ts";
import {
  RelationFields,
  type RelationFormValues,
} from "#/features/member/relation-fields.tsx";
import {
  ActivityMemberEditIssueAlert,
  ActivityMemberParticipationFields,
  refreshActivityMemberEditQueries,
  submitActivityMemberEdit,
} from "./$projectId_.activity.$activityId.members/-components/activity-member-edit";
import {
  createActivityMemberAdjacentMoveIntent,
  createActivityMemberMoveIntent,
  createActivityMemberMoveIntentFromSequences,
  createActivityMemberMoveIntentFromSortableIndex,
  formatActivityMemberSortOrder,
  parseActivityMemberSortOrder,
  resolveActivityMemberDragPlacement,
} from "./$projectId_.activity.$activityId.members/-components/activity-member-ordering";

const emptyRelation = {
  source: "",
  groupName: "",
  ownerName: "",
  remark: "",
};

const blockedResult = {
  applied: false as const,
  blocked: [
    {
      segmentMemberId: 101,
      segmentId: 31,
      segmentName: "开幕式",
      seats: [{ assignmentId: 501, seatLabel: "A-01" }],
      organizationSeats: [
        {
          assignmentId: 502,
          organizationId: 7,
          seatLabel: "B-01",
        },
      ],
      trips: [
        {
          tripId: 701,
          serviceNumber: "G1652",
          departureTime: "2026-09-01T06:00:00.000Z",
          departureLocation: "厦门",
          destination: "泉州",
        },
      ],
    },
  ],
  readOnlyRetained: [],
};

describe("活动人员关系表单", () => {
  test("新增和编辑暂不展示来源、分组，但仍展示负责人和备注", () => {
    const value: RelationFormValues = {
      source: "已有来源",
      groupName: "已有分组",
      ownerName: "王芳",
      remark: "备注",
    };

    render(
      <RelationFields
        value={value}
        onChange={() => undefined}
        ownerPhone={{ value: "13720000000", onChange: () => undefined }}
      />,
    );

    expect(screen.queryByLabelText("来源")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("分组")).not.toBeInTheDocument();
    expect(screen.getByLabelText("负责人")).toHaveValue("王芳");
    expect(screen.getByLabelText("备注")).toHaveValue("备注");
  });
});

describe("活动人员参与环节字段", () => {
  test("只回显可编辑关系，并按原因只读展示不可用历史", () => {
    render(
      <ActivityMemberParticipationFields
        segments={[
          {
            id: 31,
            name: "开幕式",
            status: "active",
            memberEnabled: true,
          },
          {
            id: 32,
            name: "主论坛",
            status: "active",
            memberEnabled: true,
          },
          {
            id: 34,
            name: "历史发布会",
            status: "voided",
            memberEnabled: true,
          },
          {
            id: 35,
            name: "关闭人员管理",
            status: "active",
            memberEnabled: false,
          },
        ]}
        memberships={[
          {
            segmentId: 31,
            name: "开幕式",
            status: "active",
            memberEnabled: true,
          },
          {
            segmentId: 34,
            name: "历史发布会",
            status: "voided",
            memberEnabled: true,
          },
          {
            segmentId: 35,
            name: "关闭人员管理",
            status: "active",
            memberEnabled: false,
          },
        ]}
        selectedIds={[31]}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText("已选 1 个")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "开幕式" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "主论坛" })).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("历史发布会")).toBeInTheDocument();
    expect(screen.getByText("环节已作废")).toBeInTheDocument();
    expect(screen.getByText("关闭人员管理")).toBeInTheDocument();
    expect(screen.getByText("未开启人员管理")).toBeInTheDocument();
  });

  test("勾选变化只回传正常且开启人员管理的最终集合", () => {
    const onChange = vi.fn();
    render(
      <ActivityMemberParticipationFields
        segments={[
          {
            id: 31,
            name: "开幕式",
            status: "active",
            memberEnabled: true,
          },
          {
            id: 32,
            name: "主论坛",
            status: "active",
            memberEnabled: true,
          },
        ]}
        memberships={[]}
        selectedIds={[31]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "主论坛" }));
    expect(onChange).toHaveBeenCalledWith([31, 32]);
  });
});

describe("活动人员参与环节保存", () => {
  test("座位或行程阻断时不继续保存关系字段，并展示三类明细", async () => {
    const updateRelation = vi.fn();
    const result = await submitActivityMemberEdit(
      {
        activityMemberId: 10,
        segmentIds: [],
        relation: emptyRelation,
      },
      {
        syncSegments: vi.fn().mockResolvedValue(blockedResult),
        updateRelation,
      },
    );

    expect(result.kind).toBe("blocked");
    expect(updateRelation).not.toHaveBeenCalled();

    render(
      <ActivityMemberEditIssueAlert
        issue={{ kind: "blocked", blockers: blockedResult.blocked }}
      />,
    );
    expect(screen.getByText(/个人座位：/)).toHaveTextContent("A-01");
    expect(screen.getByText(/团体占位：/)).toHaveTextContent("B-01（团体 #7）");
    expect(screen.getByText(/行程：/)).toHaveTextContent("G1652，厦门 → 泉州");
  });

  test("成功时严格先同步再更新，并刷新当前列表、详情和环节人员缓存", async () => {
    const calls: string[] = [];
    const result = await submitActivityMemberEdit(
      {
        activityMemberId: 10,
        segmentIds: [31, 32],
        relation: { ...emptyRelation, source: "企业嘉宾" },
      },
      {
        syncSegments: vi.fn(async () => {
          calls.push("sync");
          return {
            applied: true as const,
            added: 1,
            existing: 1,
            removed: 0,
            desiredSegmentIds: [31, 32],
            readOnlyRetained: [],
          };
        }),
        updateRelation: vi.fn(async () => {
          calls.push("update");
        }),
      },
    );

    expect(result.kind).toBe("saved");
    expect(calls).toEqual(["sync", "update"]);

    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const filters = { activityId: 20, page: 1, pageSize: 10 };
    await refreshActivityMemberEditQueries(queryClient, filters, 10);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["activityMember", "list", filters],
      refetchType: "all",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["activityMember", "detail", 10],
      refetchType: "all",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["segmentMember"],
      refetchType: "all",
    });
  });

  test("同步后关系字段失败返回明确局部成功语义，允许原样重试", async () => {
    const result = await submitActivityMemberEdit(
      {
        activityMemberId: 10,
        segmentIds: [31],
        relation: emptyRelation,
      },
      {
        syncSegments: vi.fn().mockResolvedValue({
          applied: true,
          added: 1,
          existing: 0,
          removed: 0,
          desiredSegmentIds: [31],
          readOnlyRetained: [],
        }),
        updateRelation: vi.fn().mockRejectedValue(new Error("字段冲突")),
      },
    );

    expect(result).toEqual({
      kind: "relationFailed",
      message: "字段冲突",
      participationChanged: true,
    });
  });
});

describe("活动人员排序交互", () => {
  test("接受非负安全整数，空值表示未设置", () => {
    expect(parseActivityMemberSortOrder("0")).toBe(0);
    expect(parseActivityMemberSortOrder(" 42 ")).toBe(42);
    expect(parseActivityMemberSortOrder("2147483647")).toBe(2147483647);
    expect(parseActivityMemberSortOrder("")).toBeNull();
    expect(parseActivityMemberSortOrder("-")).toBeNull();
    expect(parseActivityMemberSortOrder("-1")).toBeUndefined();
    expect(parseActivityMemberSortOrder("1.5")).toBeUndefined();
    expect(parseActivityMemberSortOrder("2147483648")).toBeUndefined();
    expect(formatActivityMemberSortOrder(null)).toBe("");
    expect(formatActivityMemberSortOrder(42)).toBe("42");
  });

  test("上下移和拖拽只生成稳定关系 ID 的移动意图", () => {
    const ids = [101, 205, 309];

    expect(createActivityMemberAdjacentMoveIntent(ids, 205, "up")).toEqual({
      sourceId: 205,
      targetId: 101,
      placement: "before",
    });
    expect(createActivityMemberAdjacentMoveIntent(ids, 205, "down")).toEqual({
      sourceId: 205,
      targetId: 309,
      placement: "after",
    });
    expect(
      createActivityMemberMoveIntent(ids, 205, 309, "before"),
    ).toBeUndefined();
    expect(
      createActivityMemberMoveIntent(ids, 205, 999, "after"),
    ).toBeUndefined();
  });

  test("指针跨过同一目标中心时仍能更新前后位置", () => {
    const ids = [101, 205, 309];
    expect(
      resolveActivityMemberDragPlacement({
        sourceIndex: 0,
        targetIndex: 1,
        positionY: 40,
        targetCenterY: 50,
      }),
    ).toBe("before");
    expect(
      createActivityMemberMoveIntent(
        ids,
        101,
        205,
        resolveActivityMemberDragPlacement({
          sourceIndex: 0,
          targetIndex: 1,
          positionY: 40,
          targetCenterY: 50,
        }),
      ),
    ).toBeUndefined();
    expect(
      resolveActivityMemberDragPlacement({
        sourceIndex: 0,
        targetIndex: 1,
        positionY: 60,
        targetCenterY: 50,
      }),
    ).toBe("after");
    expect(
      createActivityMemberMoveIntent(
        ids,
        101,
        205,
        resolveActivityMemberDragPlacement({
          sourceIndex: 0,
          targetIndex: 1,
          positionY: 60,
          targetCenterY: 50,
        }),
      ),
    ).toEqual({ sourceId: 101, targetId: 205, placement: "after" });
    expect(
      resolveActivityMemberDragPlacement({
        sourceIndex: 2,
        targetIndex: 0,
      }),
    ).toBe("before");
  });

  test("键盘连续移动按最终序列压缩为一次稳定锚点", () => {
    const initialIds = [101, 205, 309, 412];

    expect(
      createActivityMemberMoveIntentFromSequences(
        initialIds,
        [205, 309, 101, 412],
        101,
      ),
    ).toEqual({
      sourceId: 101,
      targetId: 309,
      placement: "after",
    });
    expect(
      createActivityMemberMoveIntentFromSequences(
        initialIds,
        [101, 309, 205, 412],
        205,
      ),
    ).toEqual({
      sourceId: 205,
      targetId: 309,
      placement: "after",
    });
    expect(
      createActivityMemberMoveIntentFromSequences(initialIds, initialIds, 205),
    ).toBeUndefined();
  });

  test("目标丢失时按最终 sortable index 生成移动意图", () => {
    const initialIds = [101, 205, 309, 412];

    expect(
      createActivityMemberMoveIntentFromSortableIndex(initialIds, 101, 2),
    ).toEqual({
      sourceId: 101,
      targetId: 309,
      placement: "after",
    });
    expect(
      createActivityMemberMoveIntentFromSortableIndex(initialIds, 412, 0),
    ).toEqual({
      sourceId: 412,
      targetId: 101,
      placement: "before",
    });
    expect(
      createActivityMemberMoveIntentFromSortableIndex(initialIds, 205, 1),
    ).toBeUndefined();
    expect(
      createActivityMemberMoveIntentFromSortableIndex(initialIds, 205, 99),
    ).toBeUndefined();
  });

  test("保存排序后等待活动人员相关缓存完成刷新", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    await refreshActivityMemberOrderingQueries(queryClient);

    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: ["activityMember"], refetchType: "all" },
      { throwOnError: true },
    );
  });
});
