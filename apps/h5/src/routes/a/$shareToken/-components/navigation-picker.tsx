import { Drawer } from "@base-ui/react/drawer";
import { useState } from "react";
import type { Car } from "../-queries";
import {
  buildAmapNavigationHref,
  buildAppleMapsNavigationHref,
  buildBaiduMapAppHref,
  buildBaiduNavigationHref,
  copyText,
  openMapAppWithFallback,
  supportsAppleMaps,
} from "../-utils";
import amapMapIcon from "./amap-map-icon.jpg";
import appleMapsIcon from "./apple-maps-icon.jpg";
import baiduMapIcon from "./baidu-map-icon.jpg";
import { Icon } from "./icon";
import { useToast } from "./toast-layer";

type LocationPoint = NonNullable<Car["locationPoint"]>;

/**
 * 用车集合点的地图入口。
 *
 * 选择项用 HTTPS URI 而非直接塞 app scheme：安装了客户端时服务商会接手；
 * 未安装时仍能在浏览器打开路线页，因此浏览器不必也无法事先探测用户装了什么。
 */
export function NavigationPicker({
  point,
  locationText,
}: {
  point: LocationPoint;
  locationText: string | null;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const locationDescription = point.address || locationText;
  const baiduWebHref = buildBaiduNavigationHref(point);
  const canUseAppleMaps = supportsAppleMaps();

  const copyLocation = async () => {
    const text = [point.name, locationDescription].filter(Boolean).join("\n");
    toast((await copyText(text)) ? "集合点已复制" : "复制失败，请长按地址复制");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`导航到集合点 ${point.name}`}
        className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-brand-soft px-2 font-bold text-caption text-brand active:bg-brand active:text-white"
      >
        <Icon name="navigation" size={11} />
        导航
      </button>

      <Drawer.Root open={open} onOpenChange={setOpen} swipeDirection="down">
        <Drawer.Portal>
          {/* 蒙层和面板都往视口下方多铺 33vh：iOS 26 的 fixed 定位块比实际可见
              区域短一截，`inset-0` 会在屏幕底部留一条没盖住的缝。理由和取值见
              docs/h5-itinerary.md「底部面板的下溢出」。overlay-sheet.tsx 同款。 */}
          <Drawer.Backdrop className="fixed inset-x-0 top-0 -bottom-[33vh] z-50 bg-[rgb(16_20_30)] opacity-[calc(0.5*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0" />
          <Drawer.Viewport className="fixed inset-0 z-50 flex touch-none items-end justify-center">
            <Drawer.Popup className="relative flex w-full max-w-[480px] touch-none flex-col overflow-visible rounded-t-2xl bg-surface text-ink-1 shadow-card outline-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[33vh] after:bg-[inherit] after:content-[''] data-ending-style:[transform:translateY(calc(100%+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-starting-style:[transform:translateY(calc(100%+2px))] data-swiping:select-none">
              <div className="shrink-0 touch-none select-none px-4 pt-2 pb-1">
                <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-ink-4/40" />
                <div className="flex h-11 items-center justify-between">
                  <Drawer.Title className="text-title">选择地图</Drawer.Title>
                  <Drawer.Close
                    aria-label="关闭"
                    className="-mr-2.5 flex h-11 w-11 items-center justify-center rounded-full text-ink-2 active:bg-page"
                  >
                    <Icon name="x" size={20} />
                  </Drawer.Close>
                </div>
              </div>

              <Drawer.Content className="touch-auto px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
                <div className="flex min-w-0 items-start gap-2 rounded-xl bg-page px-3 py-2.5">
                  <Icon
                    name="map-pin"
                    size={15}
                    className="mt-0.5 shrink-0 text-brand"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-bold text-body text-ink-1">
                      {point.name}
                    </p>
                    {locationDescription &&
                      locationDescription !== point.name && (
                        <p className="mt-0.5 line-clamp-2 text-caption text-ink-3">
                          {locationDescription}
                        </p>
                      )}
                  </div>
                </div>

                <div className="mt-3 overflow-hidden rounded-xl border border-line">
                  <MapOption
                    name="百度地图"
                    hint="按驾车路线前往集合点"
                    icon={baiduMapIcon}
                    href={baiduWebHref}
                    onNavigate={() =>
                      openMapAppWithFallback(
                        buildBaiduMapAppHref(point),
                        baiduWebHref,
                      )
                    }
                  />
                  <MapOption
                    name="高德地图"
                    hint="按驾车路线前往集合点"
                    icon={amapMapIcon}
                    href={buildAmapNavigationHref(point)}
                    bordered
                  />
                  {canUseAppleMaps && (
                    <MapOption
                      name="苹果地图"
                      hint="使用系统地图驾车前往集合点"
                      icon={appleMapsIcon}
                      href={buildAppleMapsNavigationHref(point)}
                      bordered
                    />
                  )}
                </div>

                <p className="mt-3 text-center text-caption text-ink-3">
                  未安装对应地图时，将在浏览器打开地图路线。
                </p>
                <button
                  type="button"
                  onClick={copyLocation}
                  className="mx-auto mt-1.5 flex h-8 items-center gap-1 rounded-md px-2 text-caption text-ink-2 active:bg-page"
                >
                  <Icon name="map-pin" size={12} />
                  复制集合点地址
                </button>
              </Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

function MapOption({
  name,
  hint,
  icon,
  href,
  onNavigate,
  bordered = false,
}: {
  name: string;
  hint: string;
  icon: string;
  href: string;
  onNavigate?: () => void;
  bordered?: boolean;
}) {
  return (
    <a
      href={href}
      aria-label={`使用${name}${hint}`}
      onClick={(event) => {
        if (!onNavigate) return;
        event.preventDefault();
        onNavigate();
      }}
      className={`flex min-h-14 items-center gap-2.5 px-3 active:bg-page ${bordered ? "border-line border-t" : ""}`}
    >
      <img src={icon} alt="" className="h-8 w-8 shrink-0 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-body text-ink-1">{name}</span>
        <span className="mt-0.5 block text-caption text-ink-3">{hint}</span>
      </span>
      <Icon name="navigation" size={15} className="shrink-0 text-ink-3" />
    </a>
  );
}
