import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { BatchDetailDialog } from "./batch-detail-dialog";

const mocks = vi.hoisted(() => ({
  single: vi.fn(),
  batch: vi.fn(),
  save: vi.fn(),
}));
vi.mock("#/features/invitation/queries", () => ({
  downloadInvitationRecord: mocks.single,
  downloadInvitationBatch: mocks.batch,
  saveBlob: mocks.save,
  invitationBatchKeys: { detail: (id: number) => ["batch", id] },
  getInvitationBatch: async () => ({
    id: 10,
    batchNo: "验收批次",
    templateName: "模板",
    issueDate: "2026-09-14",
    recipientType: "member",
    variables: {},
    records: [
      {
        id: 21,
        recipientType: "member",
        memberId: 1,
        organizationId: null,
        recipientName: "张三",
        companyPosition: "",
        mobile: null,
        createdAt: "2026-09-14",
      },
    ],
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.single.mockResolvedValue({
    blob: new Blob(["docx"]),
    fileName: "模板——张三.docx",
  });
  mocks.batch.mockResolvedValue({
    blob: new Blob(["zip"]),
    fileName: "batch.zip",
  });
});
function Wrapper() {
  return <BatchDetailDialog batchId={10} onOpenChange={() => {}} />;
}
function setup() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Wrapper />
    </QueryClientProvider>,
  );
}

test("默认 Word 单份下载沿用收件记录编号", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "下载" }));
  expect(mocks.single).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "开始下载" }));
  await waitFor(() => expect(mocks.single).toHaveBeenCalledWith(21, "docx"));
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
});

test("下载时选择 PDF，选中下载携带格式与收件对象子集", async () => {
  setup();
  await screen.findByText("张三");
  fireEvent.click(screen.getAllByRole("checkbox")[1] as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "下载选中 1 份" }));
  fireEvent.click(await screen.findByRole("combobox", { name: "导出格式" }));
  fireEvent.keyDown(
    await screen.findByRole("option", { name: "PDF（.pdf）" }),
    { key: "Enter", code: "Enter" },
  );
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "导出格式" }),
    ).toHaveTextContent("PDF（.pdf）"),
  );
  fireEvent.click(screen.getByRole("button", { name: "开始下载" }));
  await waitFor(() =>
    expect(mocks.batch).toHaveBeenCalledWith(10, [1], "member", "pdf"),
  );
});

test("转换等待期间禁用下载按钮且关闭格式弹窗", async () => {
  mocks.single.mockReturnValue(new Promise(() => {}));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "下载" }));
  fireEvent.click(await screen.findByRole("button", { name: "开始下载" }));
  await screen.findByRole("status");
  expect(
    screen.queryByRole("combobox", { name: "导出格式" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载全部" })).toBeDisabled();
});
