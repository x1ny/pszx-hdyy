import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasRow } from "../core/document";
import { DEFAULT_ROW_PARAMS, type RowParams } from "../core/rows";
import { RowPanel } from "./row-panel";

const row: CanvasRow = {
  externalId: "r1",
  zoneExternalId: "z1",
  name: "第5排",
  seatIds: ["s1", "s2", "s3"],
  shape: "line",
  x: 0,
  y: 0,
  angle: 0,
  spacing: 48,
  aisleEvery: 0,
};

function setup(creating = false) {
  const onChange = vi.fn();
  const onCreate = vi.fn();
  const onRemove = vi.fn();
  function Harness() {
    const [defaults, setDefaults] = useState<RowParams>(DEFAULT_ROW_PARAMS);
    return (
      <RowPanel
        rows={[row]}
        activeRow={creating ? undefined : row}
        creating={creating}
        defaults={defaults}
        onDefaults={setDefaults}
        onSelect={vi.fn()}
        onChange={onChange}
        onCreate={onCreate}
        onRemove={onRemove}
        onOrder={vi.fn()}
      />
    );
  }
  render(<Harness />);
  return { onChange, onCreate, onRemove };
}

describe("排参数面板", () => {
  it("修改有效参数立即生效，减座显示明确影响", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText("座位数量"), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2, name: "第5排" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("将移除排尾 1 个座位");
    expect(
      screen.queryByRole("button", { name: "应用排参数" }),
    ).not.toBeInTheDocument();
  });

  it("无效的中间输入不提交，恢复有效值后立即提交", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText("座位数量"), {
      target: { value: "" },
    });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("座位数量"), {
      target: { value: "5" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5 }),
    );
  });

  it("空值、非整数和非正间距不能创建", () => {
    setup(true);
    const count = screen.getByLabelText("座位数量");
    const create = screen.getByRole("button", { name: "按参数创建" });
    for (const value of ["", "0", "1.5"]) {
      fireEvent.change(count, { target: { value } });
      expect(create).toBeDisabled();
    }
    fireEvent.change(count, { target: { value: "5" } });
    expect(create).toBeEnabled();
    fireEvent.change(screen.getByLabelText("座位中心间距"), {
      target: { value: "-1" },
    });
    expect(create).toBeDisabled();
  });

  it("删除整排明确确认；取消不修改", () => {
    const { onRemove } = setup();
    fireEvent.click(screen.getByRole("button", { name: "删除整排" }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "删除整排" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
