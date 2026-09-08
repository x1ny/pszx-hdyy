import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import type { AgendaItem, SeatMap } from "../-queries";
import { seatMapQueryOptions } from "../-queries";
import { OverlaySheet } from "./overlay-sheet";
import { PillTag } from "./pill-tag";
import { type SeatMapLayout, seatMapLayout } from "./seat-map-layout";

/**
 * 座位定位图。
 *
 * **它回答的问题只有一个：我这个位置在这片区的哪个方位。** 不回答"邻座是谁"
 * （公众端不铺别人的名单，服务端根本不发），也不回答"哪边是舞台"——库里没有
 * 舞台和入口，推断出来的方向会指错而且没人能发现（详见 docs/h5-seat-map.md）。
 *
 * 所以其余座位一律是同一颗灰点：没有编号、没有姓名、不分种类等级、不响应点击。
 * 正因为它们长得一模一样，一万个座位才能压进**一条 path**，DOM 节点数与座位数
 * 无关。这个形态和那个性能特征是同一个决定的两面。
 *
 * 不做缩放和平移：图要一屏看全（要看的是整体形状），而这块内容装在 Drawer 里，
 * 那层已经吃掉了"向下拖"的手势——再套一层平移，往下拖到底是移动画布还是关闭
 * 面板就没有确定答案了。
 */
export function SeatMapSheet({
  shareToken,
  item,
  onClose,
}: {
  shareToken: string;
  /** 为 null 时面板关闭。关闭动画期间内容仍在，见下面的 shown。 */
  item: AgendaItem | null;
  onClose: () => void;
}) {
  /**
   * 退场动画期间 `item` 已经是 null 了，直接用它渲染会让面板在滑下去的路上先
   * 变成空白。留住最后一次的值，只用 `open` 控制开合。
   */
  const lastItem = useRef<AgendaItem | null>(null);
  if (item) lastItem.current = item;
  const shown = item ?? lastItem.current;

  const query = useQuery(seatMapQueryOptions(shareToken, shown?.id ?? null));

  return (
    <OverlaySheet
      open={item !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="座位图"
    >
      <div className="px-4 pt-3 pb-8">
        {/* 一位嘉宾一天可能有四五场都带座位图。不复述是哪一场的话，两张图长得
            差不多时很容易看串。 */}
        <h2 className="text-title leading-snug">{shown?.name}</h2>
        {shown?.locationText && (
          <div className="mt-0.5 text-caption text-ink-3">
            {shown.locationText}
          </div>
        )}

        <div className="mt-3">
          {query.isPending && <SeatMapPlaceholder />}
          {query.isError && (
            <SeatMapFallback zone={shown?.zone} seat={shown?.seat} />
          )}
          {query.data && <SeatMapBody data={query.data} />}
        </div>
      </div>
    </OverlaySheet>
  );
}

function SeatMapBody({ data }: { data: SeatMap }) {
  // 图画不出来时**只留降级那一行**：那句话里已经把区域和编号说全了，
  // 底下再挂一遍就是同一句话说两次。
  if (!data.map) {
    return <SeatMapFallback zone={data.zoneName} seat={data.seatLabel} />;
  }

  return (
    <>
      <SeatMapCanvas map={data.map} />

      {/* 图上没有任何文字（座位不带编号），所以"我是谁"由图下面这一行承担。 */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <span className="text-body text-ink-3">{data.zoneName}</span>
        <PillTag variant="solid" className="tabular-nums">
          {data.seatLabel}
        </PillTag>
      </div>
    </>
  );
}

/** 图画不出来时的样子。**不是空面板**：座位号才是嘉宾真正照着坐的东西。 */
function SeatMapFallback({
  zone,
  seat,
}: {
  zone?: string | null;
  seat?: string | null;
}) {
  return (
    <div className="rounded-xl bg-page px-4 py-6 text-center">
      <p className="text-body text-ink-2">座位图暂不可用</p>
      {zone && seat && (
        <p className="mt-1 text-caption text-ink-3">
          您的座位是 {zone} {seat}
        </p>
      )}
    </div>
  );
}

function SeatMapPlaceholder() {
  return <div className="h-24 animate-pulse rounded-xl bg-page" />;
}

/**
 * 图本体。宽度要等 DOM 量出来才知道，所以布局是一次 layout effect 之后的事。
 */
function SeatMapCanvas({ map }: { map: NonNullable<SeatMap["map"]> }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<SeatMapLayout | null>(null);

  /**
   * `useLayoutEffect` 而不是 `useEffect`：面板推上来之后紧接着量宽度、算完再
   * 画，中间不给浏览器机会先渲染一帧尺寸不对的图。
   *
   * 同时监听 resize —— 横竖屏切换会改变可用宽度，而这张图的高度是从宽度推出来
   * 的，不重算的话转屏之后内容会溢出或者缩成一条。
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const measure = () => {
      setLayout(
        seatMapLayout({
          seats: map.seats,
          mine: map.mine,
          pitch: map.pitch,
          viewWidth: box.clientWidth,
          // 下界：再扁的区也得有地方站定位钉。上界：面板本身最高
          // 100dvh - 2.25rem，图占掉不到一半，剩下留给标题和座位号。
          minHeight: 96,
          maxHeight: window.innerHeight * 0.45,
        }),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [map]);

  return (
    <div
      ref={boxRef}
      className="relative w-full overflow-hidden rounded-xl bg-page"
      style={{ height: layout ? `${layout.height}px` : "6rem" }}
    >
      {layout && (
        <>
          <svg
            width="100%"
            height="100%"
            viewBox={layout.viewBox}
            role="img"
            aria-label="所在区域的座位分布示意图"
          >
            {/*
              一条 path 装下全部座位。`M x y h0` 是零长度子路径，靠
              stroke-linecap="round" 渲染成圆点，半径由描边宽度决定；
              vector-effect="non-scaling-stroke" 让描边宽度按**屏幕像素**算，
              不受 viewBox 缩放影响，于是圆点大小完全由 dotDiameter 说了算。
            */}
            <path
              d={layout.path}
              fill="none"
              stroke="var(--color-ink-4)"
              strokeWidth={layout.dotDiameter}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/*
            定位钉是**固定屏幕尺寸**，画在 SVG 外面。一千座的图上圆点只有两三个
            像素，红点要是跟着一起缩，"我在哪"就彻底看不见了——而那是这张图存在
            的唯一理由。位置能用一行乘法算准，靠的是 viewBox 长宽比和盒子完全
            一致（见 seat-map-layout.ts）。
          */}
          <span
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute block h-3 w-3 rounded-full border-2 border-white bg-brand shadow-[0_0_0_0.25rem_rgba(232,68,46,0.25)]"
            style={{ left: `${layout.pin.left}px`, top: `${layout.pin.top}px` }}
          />
        </>
      )}
    </div>
  );
}
