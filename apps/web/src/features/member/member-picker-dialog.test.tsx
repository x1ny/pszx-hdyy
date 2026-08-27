import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberPickerDialog } from "./member-picker-dialog";
import {
  memberCandidateQueryOptions,
  organizationMemberPickerKeys,
} from "./relation-queries";

const candidates = {
  7: [
    {
      id: 1,
      name: "已在项目的人",
      gender: "unknown",
      companyPosition: "会长",
      mobile: null,
      status: "active",
      organizationId: 7,
    },
    {
      id: 2,
      name: "待加入的人",
      gender: "unknown",
      companyPosition: "秘书长",
      mobile: null,
      status: "active",
      organizationId: 7,
    },
  ],
  8: [
    {
      id: 3,
      name: "另一团体的人",
      gender: "unknown",
      companyPosition: null,
      mobile: null,
      status: "active",
      organizationId: 8,
    },
  ],
} as const;

function renderPicker(
  onOrganizationConfirm = vi.fn(async () => ({
    organizationId: 7,
    targetLayer: "project" as const,
    added: 1,
    existing: 0,
    conflict: 0,
    skipped: 0,
    items: [],
  })),
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(
    memberCandidateQueryOptions({
      scope: "all",
      page: 1,
      pageSize: 10,
    }).queryKey,
    { list: [], total: 0 },
  );
  queryClient.setQueryData(organizationMemberPickerKeys.options, [
    { id: 7, name: "协会甲" },
    { id: 8, name: "协会乙" },
  ]);
  for (const organizationId of [7, 8] as const) {
    queryClient.setQueryData(
      organizationMemberPickerKeys.candidates(organizationId),
      {
        organization: {
          id: organizationId,
          name: organizationId === 7 ? "协会甲" : "协会乙",
        },
        list: [...candidates[organizationId]],
        total: candidates[organizationId].length,
      },
    );
  }

  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <MemberPickerDialog
        open
        title="添加项目人员"
        scopes={[{ value: "all", label: "全量人员库" }]}
        excludeIds={[1]}
        organization={{
          hint: "项目层无需补齐上层关系。",
          onConfirm: onOrganizationConfirm,
        }}
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onOrganizationConfirm };
}

function chooseOption(option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "选择团体" }));
  const item = screen.getByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.click(item, { detail: 1 });
}

describe("MemberPickerDialog organization mode", () => {
  it("合并范围快照，默认全选可添加人员；切换团体会重建合法选择", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "按团体添加" }));
    chooseOption("协会甲");

    await waitFor(() =>
      expect(
        screen.getByText("已选 1 人 / 可添加 1 人 / 已在范围 1 人"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("checkbox", { name: "已在项目的人" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("已在范围内")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "待加入的人" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "待加入的人" }));
    expect(
      screen.getByText("已选 0 人 / 可添加 1 人 / 已在范围 1 人"),
    ).toBeInTheDocument();

    chooseOption("协会乙");
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "另一团体的人" }),
      ).toBeChecked(),
    );
    expect(
      screen.getByText("已选 1 人 / 可添加 1 人 / 已在范围 0 人"),
    ).toBeInTheDocument();
  });

  it("提交失败保留团体、勾选和弹窗，并就地显示业务原因", async () => {
    const onOrganizationConfirm = vi.fn(async () => {
      throw new Error("团体范围已发生变化");
    });
    const { onOpenChange } = renderPicker(onOrganizationConfirm);
    fireEvent.click(screen.getByRole("tab", { name: "按团体添加" }));
    chooseOption("协会甲");
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "待加入的人" }),
      ).toBeChecked(),
    );

    fireEvent.click(screen.getByRole("button", { name: "按团体添加 1 人" }));

    await waitFor(() =>
      expect(screen.getByText("团体范围已发生变化")).toBeInTheDocument(),
    );
    expect(onOrganizationConfirm).toHaveBeenCalledWith({
      organizationId: 7,
      memberIds: [2],
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "待加入的人" })).toBeChecked();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("未配置团体模式的既有选择器保持单一人员流程", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });
    queryClient.setQueryData(
      memberCandidateQueryOptions({
        scope: "activity",
        activityId: 9,
        page: 1,
        pageSize: 10,
      }).queryKey,
      {
        list: [
          {
            id: 4,
            name: "活动候选人",
            organizationId: null,
            companyPosition: null,
            mobile: null,
          },
        ],
        total: 1,
      },
    );
    const onConfirm = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MemberPickerDialog
          open
          title="资源台账选人"
          scopes={[{ value: "activity", label: "本活动人员", activityId: 9 }]}
          onOpenChange={vi.fn()}
          onConfirm={onConfirm}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("活动候选人"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(onConfirm).toHaveBeenCalledWith([4]);
  });
});
