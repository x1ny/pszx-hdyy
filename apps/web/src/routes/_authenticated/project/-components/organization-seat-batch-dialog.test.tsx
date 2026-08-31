import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  organizationSeatingStatsQueryOptions,
  seatingCandidatesQueryOptions,
} from "../-venue-queries";
import { OrganizationSeatBatchDialog } from "./organization-seat-batch-dialog";

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
}));

vi.mock("../-venue-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../-venue-queries")>();
  return {
    ...actual,
    unassignOrganizationSeats: mocks.release,
  };
});

const organization = {
  organizationId: 7,
  name: "协会甲",
  colorIndex: 3,
  totalMembers: 6,
  assignedPersonCount: 1,
  remainingMemberCount: 5,
  organizationSeatCount: 2,
};

function renderDialog(
  overrides: Partial<
    React.ComponentProps<typeof OrganizationSeatBatchDialog>
  > = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(organizationSeatingStatsQueryOptions(1).queryKey, {
    list: [organization],
  });
  queryClient.setQueryData(seatingCandidatesQueryOptions(1).queryKey, {
    list: [
      {
        activityMemberId: 11,
        memberId: 101,
        name: "已排成员",
        companyPosition: null,
        mobile: null,
        segmentMemberId: 21,
        organizationId: 7,
        takenSeatLabel: "A1",
      },
    ],
  });
  const onOpenChange = vi.fn();
  const onApplied = vi.fn();
  const onStartSeatSelection = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <OrganizationSeatBatchDialog
        open
        planId={1}
        readOnly={false}
        onOpenChange={onOpenChange}
        onStartSeatSelection={onStartSeatSelection}
        onApplied={onApplied}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onApplied, onOpenChange, onStartSeatSelection };
}

function chooseOrganization() {
  fireEvent.click(screen.getByRole("combobox", { name: "团体" }));
  const option = screen.getByRole("option", { name: "协会甲" });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option, { detail: 1 });
}

describe("OrganizationSeatBatchDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("选中团体后展示排位现状，并把团体和参考人数交给画布勾选", async () => {
    const { onOpenChange, onStartSeatSelection } = renderDialog();

    chooseOrganization();
    await waitFor(() =>
      expect(screen.getByText("已个人排座明细（1）")).toBeInTheDocument(),
    );
    expect(screen.getByText("已有团体占位 2")).toBeInTheDocument();
    expect(screen.getByText("剩余人数")).toBeInTheDocument();
    expect(screen.getByText("已排成员")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始选座" }));

    expect(onStartSeatSelection).toHaveBeenCalledWith({
      organizationId: 7,
      organizationName: "协会甲",
      suggestedCount: 5,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // 进画布不清掉选中的团体：勾选模式退出后不回弹窗，再来一次时它还在。
    expect(screen.getByText("已有团体占位 2")).toBeInTheDocument();
  });

  it("没有目标数量和选座方式这两组设置，选座全部交给画布", async () => {
    renderDialog();
    chooseOrganization();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开始选座" })).toBeEnabled(),
    );

    expect(screen.queryByText("目标数量")).not.toBeInTheDocument();
    expect(screen.queryByText("画布选座方式")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "预览可用位置" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "确认占位" }),
    ).not.toBeInTheDocument();
  });

  it("没选团体时不能开始选座", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "开始选座" })).toBeDisabled();
  });

  it("整体解除只请求该团体，并在二次确认后交给页面刷新", async () => {
    mocks.release.mockResolvedValue({
      seatIds: [101, 102],
      wasConfirmed: false,
    });
    const { onApplied } = renderDialog();

    chooseOrganization();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "全部解除该团体占位" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "全部解除该团体占位" }));
    expect(screen.getByText("全部解除团体占位？")).toBeInTheDocument();
    expect(
      screen.getByText(/个人分配和其他团体的占位都不会受到影响/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认全部解除" }));
    await waitFor(() => expect(mocks.release).toHaveBeenCalledWith(1, 7));
    expect(onApplied).toHaveBeenCalledOnce();
  });
});
