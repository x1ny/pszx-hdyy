/** 只声明选点使用的 JSAPI 4.0 表面，不把供应商对象保存到业务表单。 */
export type MapLocationPoint = {
  longitude: number;
  latitude: number;
  name: string;
  address: string;
  coordinateSystem: "bd09ll";
  provider: "baidu";
};

export type BaiduPoint = { lng: number; lat: number };
export type BaiduPoi = { title: string; address: string; point: BaiduPoint };
type PointHandler = (event: { point: BaiduPoint }) => void;
export type BaiduMap = {
  centerAndZoom(point: BaiduPoint, zoom: number): void;
  addOverlay(marker: BaiduMarker): void;
  addEventListener(event: "click", handler: PointHandler): void;
  destroy(): void;
};
export type BaiduMarker = {
  getPosition(): BaiduPoint;
  setPosition(point: BaiduPoint): void;
  enableDragging(): void;
  addEventListener(event: "dragend", handler: () => void): void;
};
export type BaiduSearchResults = {
  getCurrentNumPois(): number;
  getPoi(index: number): BaiduPoi;
};
export type BaiduSdk = {
  Point: new (longitude: number, latitude: number) => BaiduPoint;
  Map: new (
    container: HTMLElement,
    options: {
      center: BaiduPoint;
      zoom: number;
      enableMapClick: boolean;
    },
  ) => BaiduMap;
  Marker: new (point: BaiduPoint) => BaiduMarker;
  Geocoder: new () => {
    getLocation(
      point: BaiduPoint,
      callback: (result: { address: string } | null) => void,
    ): void;
  };
  LocalSearch: new (
    location: BaiduMap,
    options: {
      pageCapacity: number;
      onSearchComplete: (results: BaiduSearchResults) => void;
    },
  ) => {
    search(keyword: string): void;
    getStatus(): number;
    clearResults(): void;
  };
};

declare global {
  interface Window {
    BMap?: BaiduSdk;
  }
}

let loading: Promise<BaiduSdk> | undefined;
let callbackId = 0;

export function loadBaiduMap(): Promise<BaiduSdk> {
  const ak = import.meta.env.VITE_BAIDU_MAP_AK?.trim();
  if (!ak)
    return Promise.reject(
      new Error(
        "尚未配置百度地图，请联系管理员配置浏览器端 AK。仍可填写集合说明并保存。",
      ),
    );
  if (loading) return loading;
  const configureSdk = () => {
    if (!window.BMap?.Map) {
      throw new Error(
        "百度地图未正确加载，请检查 AK 类型、服务权限和域名白名单。",
      );
    }
    // 沿用百度默认 BD-09，避免搜索结果与 click 事件在 GCJ 模式下坐标系不一致。
    return window.BMap;
  };
  if (window.BMap?.Map) return Promise.resolve().then(configureSdk);

  loading = new Promise<BaiduSdk>((resolve, reject) => {
    const callback = `__baiduLocationReady${++callbackId}`;
    const callbacks = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      // 过期的 SDK 请求可能仍会调用 callback，留下空函数避免未捕获异常。
      callbacks[callback] = () => {};
      if (error) {
        script.remove();
        reject(error);
      } else {
        try {
          resolve(configureSdk());
        } catch (cause) {
          reject(cause);
        }
      }
    };
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "地图加载超时，请检查网络、AK 和百度控制台的认证状态后重试。",
          ),
        ),
      15000,
    );
    callbacks[callback] = () => finish();
    script.async = true;
    script.src = `https://api.map.baidu.com/api?v=4.0&ak=${encodeURIComponent(ak)}&callback=${callback}`;
    script.onerror = () =>
      finish(new Error("无法连接百度地图，请检查网络后重试。"));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
