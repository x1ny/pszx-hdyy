import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TripBatchDialog } from "./trip-batch-dialog";

const options = {
  organizations: [
    { id: 7, name: "协会甲" },
    { id: 8, name: "协会乙" },
  ],
  members: [
    {
      activityMemberId: 11,
      memberId: 101,
      organizationId: 7,
      name: "甲成员",
      companyPosition: "会长",
    },
    {
      activityMemberId: 12,
      memberId: 102,
      organizationId: 7,
      name: "乙成员",
      companyPosition: null,
    },
    {
      activityMemberId: 21,
      memberId: 201,
      organizationId: 8,
      name: "丙成员",
      companyPosition: "秘书长",
    },
  ],
};

const renderDialog = (overrides: Record<string, unknown> = {}) => {
  const props = {
    open: true,
    activityId: 3,
    activityName: "测试活动",
    segmentId: null,
    segments: [{ id: 9, name: "主论坛" }],
    options,
    optionsPending: false,
    optionsError: null,
    submitError: null,
    submitting: false,
    onOpenChange: vi.fn(),
    onSegmentChange: vi.fn(),
    onRetryOptions: vi.fn(),
    onClearSubmitError: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  const view = render(<TripBatchDialog {...props} />);
  return {
    ...props,
    rerenderWith: (next: Record<string, unknown>) =>
      view.rerender(<TripBatchDialog {...props} {...next} />),
  };
};

const chooseSelectOption = (label: RegExp, option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = screen.getByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.click(item, { detail: 1 });
};

describe("TripBatchDialog", () => {
  it("明确每人生成独立行程，并在缺少范围选择时就地展示字段错误", async () => {
    renderDialog();

    expect(
      screen.getByText(
        "选择范围和成员后，系统会为每名最终勾选人员分别生成一条独立行程。",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "为 0 人创建独立行程" }),
    );

    await waitFor(() =>
      expect(screen.getAllByText("请选择团体")).toHaveLength(2),
    );
    expect(screen.getByText("至少选择一名人员")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("选团体默认全选，支持逐人取消；切换环节立即清空旧成员", async () => {
    const props = renderDialog();

    chooseSelectOption(/团体/, "协会甲");
    await waitFor(() =>
      expect(screen.getByText("已选 2 / 2")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "甲成员" }));
    expect(screen.getByText("已选 1 / 2")).toBeInTheDocument();

    chooseSelectOption(/关联环节/, "主论坛");
    expect(props.onSegmentChange).toHaveBeenCalledWith(9);
    expect(screen.getByText("已选 0 / 2")).toBeInTheDocument();
  });

  it("新环节加载期间不丢失仍合法的团体，响应后按新范围重新全选", async () => {
    const props = renderDialog();

    chooseSelectOption(/团体/, "协会甲");
    await waitFor(() =>
      expect(screen.getByText("已选 2 / 2")).toBeInTheDocument(),
    );

    props.rerenderWith({
      segmentId: 9,
      options: undefined,
      optionsPending: true,
    });
    expect(screen.getByRole("combobox", { name: /团体/ })).toHaveTextContent(
      "协会甲",
    );

    props.rerenderWith({
      segmentId: 9,
      options: {
        organizations: [options.organizations[0]],
        members: [options.members[0]],
      },
      optionsPending: false,
    });
    await waitFor(() =>
      expect(screen.getByText("已选 1 / 1")).toBeInTheDocument(),
    );
    expect(screen.getByRole("checkbox", { name: "甲成员" })).toBeChecked();
  });

  it("把最终成员和共享字段提交为批量创建请求", async () => {
    const props = renderDialog();

    chooseSelectOption(/团体/, "协会甲");
    chooseSelectOption(/交通方式/, "动车");
    fireEvent.change(screen.getByLabelText("出发时间 *"), {
      target: { value: "2026-09-01T08:00" },
    });
    fireEvent.change(screen.getByLabelText("到达时间 *"), {
      target: { value: "2026-09-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText("出发地 *"), {
      target: { value: "厦门" },
    });
    fireEvent.change(screen.getByLabelText("目的地 *"), {
      target: { value: "泉州" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "为 2 人创建独立行程" }),
    );

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledOnce());
    expect(props.onSubmit).toHaveBeenCalledWith({
      activityId: 3,
      organizationId: 7,
      segmentId: null,
      activityMemberIds: [11, 12],
      transportMode: "train",
      serviceNumber: undefined,
      departureTime: new Date("2026-09-01T08:00"),
      arrivalTime: new Date("2026-09-01T10:00"),
      departureLocation: "厦门",
      destination: "泉州",
    });
  });

  it("接口错误保留弹窗和已填字段，并在继续修改时清除旧错误", () => {
    const props = renderDialog({ submitError: new Error("团体范围已变化") });

    expect(screen.getByText("批量创建失败")).toBeInTheDocument();
    expect(screen.getByText("团体范围已变化")).toBeInTheDocument();

    const departureLocation = screen.getByLabelText("出发地 *");
    fireEvent.change(departureLocation, { target: { value: "厦门" } });

    expect(departureLocation).toHaveValue("厦门");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(props.onClearSubmitError).toHaveBeenCalledOnce();
  });

  it("范围选项加载失败时展示原因并允许原地重试", () => {
    const props = renderDialog({
      optionsError: new Error("范围加载失败"),
    });

    expect(screen.getByText("范围选项加载失败")).toBeInTheDocument();
    expect(screen.getByText("范围加载失败")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "为 0 人创建独立行程" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(props.onRetryOptions).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
