import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  organizationSeatingStatsQueryOptions,
  seatingCandidatesQueryOptions,
} from "../-venue-queries";
import { OrganizationSeatBatchDialog } from "./organization-seat-batch-dialog";

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  preview: vi.fn(),
  release: vi.fn(),
}));

vi.mock("../-venue-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../-venue-queries")>();
  return {
    ...actual,
    assignOrganizationSeatBatch: mocks.assign,
    previewOrganizationSeatBatch: mocks.preview,
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

const previewResult = {
  organization,
  targetCount: 2,
  preview: {
    availableSeatIds: [101, 102],
    plannedSeatIds: [101, 102],
    skipped: [],
    insufficient: 0,
  },
};

function renderDialog() {
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

  const props = {
    open: true,
    planId: 1,
    selectedSeats: [
      { id: 101, label: "A1" },
      { id: 102, label: "A2" },
    ],
    readOnly: false,
    onOpenChange,
    onApplied,
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OrganizationSeatBatchDialog {...props} />
    </QueryClientProvider>,
  );
  return {
    onApplied,
    onOpenChange,
    rerenderWith: (next: Partial<typeof props>) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <OrganizationSeatBatchDialog {...props} {...next} />
        </QueryClientProvider>,
      ),
  };
}

function chooseOrganization() {
  fireEvent.click(screen.getByRole("combobox", { name: "团体" }));
  const option = screen.getByRole("option", { name: "协会甲" });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option, { detail: 1 });
}

describe("OrganizationSeatBatchDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("按画布位置顺序预览并批量写入，成功后交给页面刷新和清选", async () => {
    mocks.preview.mockResolvedValue(previewResult);
    mocks.assign.mockResolvedValue({
      applied: true,
      organization,
      targetCount: 2,
      seatIds: [101, 102],
      wasConfirmed: false,
    });
    const { onApplied, onOpenChange } = renderDialog();

    chooseOrganization();
    await waitFor(() =>
      expect(screen.getByText("已个人排座明细（1）")).toBeInTheDocument(),
    );
    expect(screen.getByText("已排成员 · A1")).toBeInTheDocument();
    expect(screen.getByText("画布已选 2 个位置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "预览可用位置" }));
    await waitFor(() =>
      expect(mocks.preview).toHaveBeenCalledWith({
        planId: 1,
        organizationId: 7,
        orderedSeatIds: [101, 102],
        targetMode: "remaining",
      }),
    );
    expect(screen.getByText("计划占位 2 / 目标 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认占位" }));
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith({
        planId: 1,
        organizationId: 7,
        orderedSeatIds: [101, 102],
        targetMode: "remaining",
      }),
    );
    expect(onApplied).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
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

  it("预览请求中选择变化时不把旧预览当成当前结果", async () => {
    let resolvePreview: ((result: typeof previewResult) => void) | undefined;
    mocks.preview.mockReturnValueOnce(
      new Promise<typeof previewResult>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const props = renderDialog();

    chooseOrganization();
    fireEvent.click(screen.getByRole("button", { name: "预览可用位置" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "团体" })).toBeDisabled(),
    );

    props.rerenderWith({ selectedSeats: [{ id: 103, label: "A3" }] });
    if (!resolvePreview) throw new Error("预览请求没有启动");
    resolvePreview(previewResult);

    await waitFor(() =>
      expect(screen.queryByText("预览结果")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "确认占位" })).toBeDisabled();
  });
});
