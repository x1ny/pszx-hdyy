import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { organizationSeatColor } from "#/features/venue-editor/canvas/seat-occupant-visual";
import {
  type PlanSeatRow,
  type SeatingCandidate,
  seatingCandidatesQueryOptions,
} from "../-venue-queries";
import { SeatAssignPanel } from "./seat-assign-panel";

const DEFAULT_SEAT: PlanSeatRow = {
  id: 301,
  externalId: "seat-301",
  sourceExternalId: null,
  zoneExternalId: null,
  label: "A1",
  kind: "seat",
  rank: "normal",
  enabled: true,
  ordinal: 1,
};

const DEFAULT_CANDIDATES: SeatingCandidate[] = [
  {
    activityMemberId: 11,
    memberId: 101,
    name: "已个人排座",
    companyPosition: "成员",
    mobile: null,
    segmentMemberId: 21,
    organizationId: 7,
    takenSeatLabel: "D1",
  },
  {
    activityMemberId: 12,
    memberId: 102,
    name: "团体成员",
    companyPosition: null,
    mobile: null,
    segmentMemberId: 22,
    organizationId: 7,
    takenSeatLabel: null,
  },
  {
    activityMemberId: 13,
    memberId: 103,
    name: "未排座",
    companyPosition: null,
    mobile: null,
    segmentMemberId: 23,
    organizationId: null,
    takenSeatLabel: null,
  },
];

function renderPanel(
  candidates = DEFAULT_CANDIDATES,
  seat: PlanSeatRow | null = DEFAULT_SEAT,
) {
  const onAssign = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(seatingCandidatesQueryOptions(1).queryKey, {
    list: candidates,
  });

  render(
    <QueryClientProvider client={queryClient}>
      <SeatAssignPanel
        planId={1}
        seat={seat}
        assignment={null}
        readOnly={false}
        pending={false}
        organizationSeatInfoById={
          new Map([[7, { name: "外语志愿者团", seatLabels: ["D2", "D4"] }]])
        }
        onAssign={onAssign}
        onUnassign={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onAssign };
}

describe("SeatAssignPanel", () => {
  it("默认只显示未排座人员，并可切换到全部人员", () => {
    renderPanel();

    expect(screen.getByText("未排座")).toBeInTheDocument();
    expect(screen.queryByText("已个人排座")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全部人员" }));

    expect(screen.getByText("已个人排座")).toBeInTheDocument();
    expect(screen.getByText("在 D1")).toBeInTheDocument();
  });

  it("未选中座位时显示提示和人员列表，但不能直接排座", () => {
    const { onAssign } = renderPanel(DEFAULT_CANDIDATES, null);

    expect(screen.getByText("当前未选中座位")).toBeInTheDocument();
    expect(screen.getByText("未排座")).toBeInTheDocument();
    expect(screen.getByText("第 1-2 条 / 共 2 条")).toBeInTheDocument();

    const personButton = screen.getByText("未排座").closest("button");
    expect(personButton).toBeDisabled();
    fireEvent.click(personButton as HTMLButtonElement);
    expect(onAssign).not.toHaveBeenCalled();
  });

  it("已占多座的人员仍可安排到新座位，并显示全部已有座位", () => {
    const { onAssign } = renderPanel([
      { ...DEFAULT_CANDIDATES[0], takenSeatLabel: "D1、D3、E2" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "全部人员" }));
    expect(screen.getByText("在 D1、D3、E2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /已个人排座/ }));
    expect(onAssign).toHaveBeenCalledWith(21);
    expect(screen.getByText(/点击后保留其已有座位/)).toBeInTheDocument();
  });
  it("显示候选人的团体名称，并区分个人已排座和团体占位座位", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "全部人员" }));

    const organizationLabels = screen.getAllByText("外语志愿者团");
    expect(organizationLabels).toHaveLength(2);
    for (const label of organizationLabels) {
      expect(label).toHaveStyle({ color: organizationSeatColor(7).stroke });
      expect(label).not.toHaveClass("border");
    }
    expect(screen.getByText("在 D1")).toBeInTheDocument();
    expect(screen.getByText("团体座位")).toBeInTheDocument();
  });

  it("每页显示八名候选人，并可翻到下一页", () => {
    renderPanel(
      Array.from({ length: 9 }, (_, index) => ({
        activityMemberId: index + 1,
        memberId: index + 101,
        name: `候选人 ${index + 1}`,
        companyPosition: "成员",
        mobile: null,
        segmentMemberId: index + 201,
        organizationId: null,
        takenSeatLabel: null,
      })),
    );

    expect(screen.getByText("候选人 1")).toBeInTheDocument();
    expect(screen.queryByText("候选人 9")).not.toBeInTheDocument();
    expect(screen.getByText("第 1-8 条 / 共 9 条")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    expect(screen.queryByText("候选人 1")).not.toBeInTheDocument();
    expect(screen.getByText("候选人 9")).toBeInTheDocument();
    expect(screen.getByText("第 9-9 条 / 共 9 条")).toBeInTheDocument();
  });
});
