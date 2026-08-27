import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  ActivityMemberEditIssueAlert,
  ActivityMemberParticipationFields,
  refreshActivityMemberEditQueries,
  submitActivityMemberEdit,
} from "./$projectId_.activity.$activityId.members/-components/activity-member-edit";

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
