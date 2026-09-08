import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BaiduPoint,
  type BaiduSdk,
  loadBaiduMap,
} from "#/shared/lib/baidu-map";
import { BaiduLocationPicker } from "./baidu-location-picker";

vi.mock("#/shared/lib/baidu-map", () => ({ loadBaiduMap: vi.fn() }));

let clickMap: (event: { point: BaiduPoint }) => void;
let reverseCallbacks: Array<(result: { address: string } | null) => void>;
const destroy = vi.fn();
const selectedPoint = {
  longitude: 120.1,
  latitude: 30.2,
  name: "集合入口",
  address: "杭州",
  provider: "baidu" as const,
  coordinateSystem: "bd09ll" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  reverseCallbacks = [];
  class Point {
    constructor(
      public lng: number,
      public lat: number,
    ) {}
  }
  class TestMap {
    addEventListener(_event: string, callback: typeof clickMap) {
      clickMap = callback;
    }
    addOverlay() {}
    centerAndZoom() {}
    destroy = destroy;
  }
  class Marker {
    enableDragging() {}
    addEventListener() {}
    setPosition() {}
  }
  class Geocoder {
    getLocation(
      _point: BaiduPoint,
      callback: (result: { address: string } | null) => void,
    ) {
      reverseCallbacks.push(callback);
    }
  }
  vi.mocked(loadBaiduMap).mockResolvedValue({
    Point,
    Map: TestMap,
    Marker,
    Geocoder,
  } as unknown as BaiduSdk);
});

async function openPicker(button = "地图选点") {
  fireEvent.click(screen.getByRole("button", { name: button }));
  await waitFor(() =>
    expect(screen.queryByText("正在加载百度地图…")).not.toBeInTheDocument(),
  );
}

describe("百度地图选点草稿", () => {
  it("取消不提交；确认才提交精确点击坐标，迟到的逆解析不覆盖新点", async () => {
    const onChange = vi.fn();
    render(<BaiduLocationPicker value={null} onChange={onChange} />);
    await openPicker();
    act(() => clickMap({ point: { lng: 120.1, lat: 30.2 } }));
    act(() => clickMap({ point: { lng: 121.3, lat: 31.4 } }));
    fireEvent.change(screen.getByLabelText("定位点名称"), {
      target: { value: "东门集合" },
    });
    act(() => reverseCallbacks[1]?.({ address: "新点地址" }));
    act(() => reverseCallbacks[0]?.({ address: "旧点地址" }));
    expect(screen.queryByText("旧点地址")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认选点" }));
    expect(onChange).toHaveBeenCalledWith({
      ...selectedPoint,
      longitude: 121.3,
      latitude: 31.4,
      name: "东门集合",
      address: "新点地址",
    });
    expect(destroy).toHaveBeenCalled();
  });

  it("已有定位重新选点后取消保留原值，清除显式提交 null", async () => {
    const onChange = vi.fn();
    render(<BaiduLocationPicker value={selectedPoint} onChange={onChange} />);
    await openPicker("重新选点");
    expect(screen.getByLabelText("定位点名称")).toHaveValue("集合入口");
    act(() => clickMap({ point: { lng: 1, lat: 2 } }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除定位" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("地图失败时展示重试入口，取消不丢已有定位", async () => {
    vi.mocked(loadBaiduMap).mockRejectedValueOnce(new Error("AK 未配置"));
    const onChange = vi.fn();
    render(<BaiduLocationPicker value={selectedPoint} onChange={onChange} />);
    await openPicker("重新选点");
    expect(screen.getByRole("alert")).toHaveTextContent("AK 未配置");
    expect(screen.getByRole("button", { name: "确认选点" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
