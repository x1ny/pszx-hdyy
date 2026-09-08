import { Loader2Icon, MapPinIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  type BaiduMap,
  type BaiduMarker,
  type BaiduPoi,
  type BaiduPoint,
  loadBaiduMap,
  type MapLocationPoint,
} from "#/shared/lib/baidu-map";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

type BaiduLocationPickerProps = {
  value: MapLocationPoint | null;
  onChange: (value: MapLocationPoint | null) => void;
  searchHint?: string;
};

export function BaiduLocationPicker({
  value,
  onChange,
  searchHint = "",
}: BaiduLocationPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          <MapPinIcon data-icon="inline-start" />
          {value ? "重新选点" : "地图选点"}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
          >
            清除定位
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">
            选填，用于准确定位集合地点
          </span>
        )}
      </div>
      {value ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{value.name}</p>
          {value.address ? (
            <p className="text-muted-foreground">{value.address}</p>
          ) : null}
          <p className="mt-1 text-muted-foreground text-xs">
            经度 {value.longitude.toFixed(6)}，纬度 {value.latitude.toFixed(6)}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            修改集合说明不会移动定位点，需要时请重新选点。
          </p>
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        {/* 百度 SDK 按布局偏移算点击像素；transform 居中会使点击坐标偏离画面。 */}
        <DialogContent className="top-0 right-0 bottom-0 left-0 m-auto h-fit translate-x-0 translate-y-0 sm:max-w-4xl data-open:animate-none data-closed:animate-none">
          <DialogHeader>
            <DialogTitle>地图选点</DialogTitle>
            <DialogDescription>
              搜索地点后选择结果，或点击地图、拖动标记微调。请尽量选在实际集合的入口。
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <PickerContent
              initialValue={value}
              searchHint={searchHint}
              onCancel={() => setOpen(false)}
              onConfirm={(point) => {
                onChange(point);
                setOpen(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PickerContent({
  initialValue,
  searchHint,
  onCancel,
  onConfirm,
}: {
  initialValue: MapLocationPoint | null;
  searchHint: string;
  onCancel: () => void;
  onConfirm: (point: MapLocationPoint) => void;
}) {
  const initial = useRef(initialValue);
  const container = useRef<HTMLDivElement>(null);
  const search = useRef<(keyword: string) => void>(() => {});
  const pickPoi = useRef<(poi: BaiduPoi) => void>(() => {});
  const [selected, setSelected] = useState(initialValue);
  const [keyword, setKeyword] = useState(initialValue?.name ?? searchHint);
  const [results, setResults] = useState<BaiduPoi[]>([]);
  const [ready, setReady] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const nameId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt 是用户主动重试加载地图的触发器。
  useEffect(() => {
    let disposed = false;
    let map: BaiduMap | undefined;
    let marker: BaiduMarker | undefined;
    let selectionVersion = 0;
    let searchVersion = 0;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let clearSearch: (() => void) | undefined;
    setReady(false);
    setError("");
    loadBaiduMap()
      .then((sdk) => {
        if (disposed || !container.current) return;
        const saved = initial.current;
        // 未选点时只展示全国视野，不把默认中心当成用户已选择的位置。
        map = new sdk.Map(container.current, {
          center: saved
            ? new sdk.Point(saved.longitude, saved.latitude)
            : new sdk.Point(105, 35),
          zoom: saved ? 17 : 5,
          enableMapClick: false,
        });
        const geocoder = new sdk.Geocoder();
        const moveMarker = (point: BaiduPoint) => {
          if (!marker) {
            marker = new sdk.Marker(point);
            marker.enableDragging();
            marker.addEventListener("dragend", () => {
              if (marker) selectPoint(marker.getPosition());
            });
            map?.addOverlay(marker);
          } else marker.setPosition(point);
        };
        const selectPoint = (point: BaiduPoint, poi?: BaiduPoi) => {
          if (disposed) return;
          const version = ++selectionVersion;
          moveMarker(point);
          setSelected({
            longitude: point.lng,
            latitude: point.lat,
            name: (poi?.title || "地图选点").slice(0, 255),
            address: (poi?.address || "").slice(0, 500),
            coordinateSystem: "bd09ll",
            provider: "baidu",
          });
          if (poi) return;
          geocoder.getLocation(point, (result) => {
            if (disposed || version !== selectionVersion) return;
            // 逆解析只补地址，不用附近 POI 坐标覆盖用户点中的位置。
            setSelected((current) =>
              current
                ? { ...current, address: (result?.address || "").slice(0, 500) }
                : current,
            );
          });
        };
        if (saved) moveMarker(new sdk.Point(saved.longitude, saved.latitude));
        map.addEventListener("click", (event) => selectPoint(event.point));
        pickPoi.current = (poi) => {
          selectPoint(poi.point, poi);
          map?.centerAndZoom(poi.point, 18);
        };
        search.current = (query) => {
          if (!map) return;
          const version = ++searchVersion;
          clearTimeout(searchTimer);
          clearSearch?.();
          setSearching(true);
          setResults([]);
          setMessage("");
          const localSearch = new sdk.LocalSearch(map, {
            pageCapacity: 10,
            onSearchComplete: (response) => {
              if (disposed || version !== searchVersion) return;
              clearTimeout(searchTimer);
              setSearching(false);
              if (localSearch.getStatus() !== 0) {
                setMessage(
                  "未找到地点或搜索服务不可用，请补充城市名称重试，也可直接点击地图选点。",
                );
                return;
              }
              const pois = Array.from(
                { length: response.getCurrentNumPois() },
                (_, index) => response.getPoi(index),
              ).filter((poi) => poi.point);
              setResults(pois);
              setMessage(
                pois.length
                  ? "请选择一条搜索结果，再在地图上微调位置。"
                  : "未找到地点，请补充城市名称重试。",
              );
            },
          });
          clearSearch = () => localSearch.clearResults();
          searchTimer = setTimeout(() => {
            if (disposed || version !== searchVersion) return;
            ++searchVersion;
            setSearching(false);
            setMessage("搜索超时，请重试或直接点击地图选点。");
          }, 10000);
          localSearch.search(query);
        };
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setError(
            cause instanceof Error ? cause.message : "地图加载失败，请重试。",
          );
      });
    return () => {
      disposed = true;
      clearTimeout(searchTimer);
      clearSearch?.();
      map?.destroy();
    };
  }, [attempt]);

  const runSearch = () => {
    if (keyword.trim() && ready) search.current(keyword.trim());
  };
  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Input
            aria-label="搜索地图地点"
            placeholder="输入城市、酒店、机场或详细地址"
            value={keyword}
            maxLength={255}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                runSearch();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!ready || !keyword.trim() || searching}
            onClick={runSearch}
          >
            {searching ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SearchIcon />
            )}
            搜索
          </Button>
        </div>
        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
          >
            <p>{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAttempt((value) => value + 1)}
            >
              重试
            </Button>
          </div>
        ) : null}
        {!ready && !error ? (
          <output className="text-muted-foreground text-sm">
            正在加载百度地图…
          </output>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border p-2 sm:max-h-96">
            <p aria-live="polite" className="p-1 text-muted-foreground text-xs">
              {message || "输入地点搜索，或直接在右侧地图选点。"}
            </p>
            {results.map((poi) => (
              <Button
                key={`${poi.point.lng}-${poi.point.lat}-${poi.title}`}
                type="button"
                variant="ghost"
                className="h-auto justify-start whitespace-normal py-2 text-left"
                onClick={() => pickPoi.current(poi)}
              >
                <span>
                  <span className="block font-medium">{poi.title}</span>
                  <span className="block text-muted-foreground text-xs">
                    {poi.address}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          <div
            ref={container}
            role="img"
            aria-label="百度地图，点击选择集合点，可拖动标记微调"
            className="h-96 min-w-0 overflow-hidden rounded-md border bg-muted"
          />
        </div>
        {selected ? (
          <Field>
            <FieldLabel htmlFor={nameId}>定位点名称</FieldLabel>
            <Input
              id={nameId}
              value={selected.name}
              maxLength={255}
              onChange={(event) =>
                setSelected({ ...selected, name: event.target.value })
              }
            />
            <p className="text-muted-foreground text-xs">
              {selected.address || "未取得地址，可填写定位点名称后确认。"}
            </p>
            <p className="text-muted-foreground text-xs">
              经度 {selected.longitude.toFixed(6)}，纬度{" "}
              {selected.latitude.toFixed(6)}
            </p>
          </Field>
        ) : (
          <p className="text-muted-foreground text-sm">尚未选择定位点</p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="button"
          disabled={!ready || !selected?.name.trim()}
          onClick={() => {
            if (selected?.name.trim())
              onConfirm({ ...selected, name: selected.name.trim() });
          }}
        >
          确认选点
        </Button>
      </DialogFooter>
    </>
  );
}
