import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { seatingCandidatesQueryOptions } from "../-venue-queries";
import { SeatAssignPanel } from "./seat-assign-panel";

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(seatingCandidatesQueryOptions(1).queryKey, {
    list: [
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
    ],
  });

  render(
    <QueryClientProvider client={queryClient}>
      <SeatAssignPanel
        planId={1}
        seat={{
          id: 301,
          externalId: "seat-301",
          sourceExternalId: null,
          label: "A1",
          kind: "seat",
          rank: "normal",
          enabled: true,
          ordinal: 1,
        }}
        assignment={null}
        readOnly={false}
        pending={false}
        organizationSeatInfoById={
          new Map([
            [
              7,
              { name: "外语志愿者团", seatLabels: ["D2", "D4"] },
            ],
          ])
        }
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("SeatAssignPanel", () => {
  it("显示候选人的团体名称，并区分个人已排座和团体占位座位", async () => {
    renderPanel();

    expect(screen.getAllByText("外语志愿者团")).toHaveLength(2);
    expect(screen.getByText("在 D1")).toBeInTheDocument();
    expect(screen.getByText("团体座位 D2、D4")).toBeInTheDocument();
  });
});
