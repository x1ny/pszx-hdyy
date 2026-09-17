import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import type { AgendaItem, SeatMap } from "../-queries";
import { seatMapQueryOptions } from "../-queries";
import { OverlaySheet } from "./overlay-sheet";
import {
  enlargeMark,
  MARK_VERTICAL_ADVANCE,
  markTextColor,
  type SeatMapLayout,
  type SeatMapMarkShape,
  seatMapLayout,
} from "./seat-map-layout";

/**
 * 座位定位图。
 *
 * **它回答的问题只有一个：我这个位置在这片区的哪个方位。** 不回答"邻座是谁"
 * （公众端不铺别人的名单，服务端根本不发）。方向只靠运营在管理端画的标注
 * （舞台、门口……），不从座位坐标推断（详见 docs/h5-seat-map.md）。
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
      title="我的座位"
    >
      <div className="px-4 pt-3 pb-8">
        {/* 座位号、场馆和区域来自行程主接口，不用等座位图那次单独请求——嘉宾最先
            要确认的是"我坐哪"，这行不该跟着画布一起转圈。这里用座位方案的场馆/区域，
            不用环节的 locationText（它是环节地址，不一定能准确标识座位所在场馆）。 */}
        {shown && (
          <div className="flex items-center gap-3 rounded-2xl bg-page p-3">
            <div className="flex min-h-14 min-w-14 max-w-1/2 shrink-0 items-center justify-center break-words rounded-xl bg-brand-soft px-2 py-2 text-title text-brand tabular-nums">
              {shown.seat}
            </div>
            <div className="min-w-0">
              {shown.venueName && (
                <div className="break-words text-title text-ink-1">
                  {shown.venueName}
                </div>
              )}
              {shown.zone && (
                <div
                  className={
                    shown.venueName
                      ? "mt-0.5 break-words text-body text-ink-2"
                      : "break-words text-title text-ink-1"
                  }
                >
                  {shown.zone}
                </div>
              )}
              <div className="mt-0.5 truncate text-caption text-ink-3">
                议程：{shown.name}
              </div>
            </div>
          </div>
        )}

        <div className="mt-3">
          {query.isPending && <SeatMapPlaceholder />}
          {query.isError && <SeatMapFallback />}
          {query.data && <SeatMapBody data={query.data} />}
        </div>
      </div>
    </OverlaySheet>
  );
}

function SeatMapBody({ data }: { data: SeatMap }) {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  // 场馆、议程、座位号已经在上面那张卡片里说完了，图画不出来时不需要
  // 第二种响应形状，直接复用同一句降级文案。
  if (!data.map) {
    return <SeatMapFallback />;
  }

  const mine =
    data.map.mine.find((seat) => seat.label === selectedLabel) ??
    data.map.mine[0];
  if (!mine) return <SeatMapFallback />;

  return (
    <>
      {data.map.mine.length > 1 && (
        <div className="mb-3">
          <p className="mb-2 text-caption text-ink-3">选择座位查看位置</p>
          <div className="flex flex-wrap gap-2">
            {data.map.mine.map((seat) => (
              <button
                key={seat.label}
                type="button"
                aria-pressed={seat.label === mine.label}
                onClick={() => setSelectedLabel(seat.label)}
                className={`rounded-lg px-3 py-2 text-body ${seat.label === mine.label ? "bg-brand-soft text-brand" : "bg-page text-ink-2"}`}
              >
                {seat.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <SeatMapCanvas
        map={
          data.map.sections?.find((section) =>
            section.mine.some((seat) => seat.label === mine.label),
          ) ?? data.map
        }
        highlights={[mine]}
      />
    </>
  );
}

/** 图画不出来时的样子。座位号已经在上面的卡片里，这里不用再说一遍。 */
export function SeatMapFallback() {
  return (
    <div className="rounded-xl bg-page px-4 py-6 text-center">
      <p className="text-body text-ink-2">座位图暂不可用</p>
    </div>
  );
}

export function SeatMapPlaceholder() {
  return <div className="h-24 animate-pulse rounded-xl bg-page" />;
}

/**
 * 图本体。宽度要等 DOM 量出来才知道，所以布局是一次 layout effect 之后的事。
 */
export type SeatMapMarker = { x: number; y: number; label: string };
export type SeatMapTable =
  | { shape: "circle"; x: number; y: number; radius: number }
  | {
      shape: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      angle: number;
    };
export type SeatMapData = {
  seats: { x: number; y: number }[];
  mine: SeatMapMarker[];
  pitch: number;
  /** 圆桌/方桌的家具外框，只有形状和位置，见 docs/h5-seat-map.md。 */
  tables?: SeatMapTable[];
  /** 运营画的主题板、门口等标注：形状 + 颜色 + 文字，帮嘉宾辨认方向。 */
  marks?: SeatMapMark[];
};
export type SeatMapMark = SeatMapMarkShape & { color: string };

/** `text-caption` 的字号（rem）。根字号随屏宽缩放，判断放不放得下要换算成像素。 */
const LABEL_FONT_REM = 0.6875;

export function SeatMapCanvas({
  map,
  highlights,
  highlightMode = "pin",
}: {
  map: SeatMapData;
  highlights: readonly SeatMapMarker[];
  /** 个人座位显示定位钉；团体座位按参考样式把所有占位都标红。 */
  highlightMode?: "pin" | "seats";
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<SeatMapLayout | null>(null);
  const focus = highlights[0];

  /**
   * `useLayoutEffect` 而不是 `useEffect`：面板推上来之后紧接着量宽度、算完再
   * 画，中间不给浏览器机会先渲染一帧尺寸不对的图。
   *
   * 同时监听 resize —— 横竖屏切换会改变可用宽度，而这张图的高度是从宽度推出来
   * 的，不重算的话转屏之后内容会溢出或者缩成一条。
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !focus) return;

    const measure = () => {
      setLayout(
        seatMapLayout({
          seats: map.seats,
          mine: focus,
          marks: map.marks,
          labelFontPx:
            Number.parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            ) * LABEL_FONT_REM,
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
  }, [map, focus]);

  if (!focus) return null;
  const highlightPath = highlightsToPath(highlights);
  const marks = map.marks ?? [];
  const legend = legendItems(marks, layout);

  return (
    <>
      {/*
        写不进形状的标注在图上方按颜色列出来。放在图外，不挡座位，也不改变图的
        尺寸；色块画成标注自己的形状，同色的方块和圆也能分开。
      */}
      {legend.length > 0 && (
        <ul
          className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-ink-2"
          aria-label="图中标注说明"
        >
          {legend.map((mark) => (
            <li
              key={`${mark.color}-${mark.shape}-${mark.label}`}
              className="flex items-center gap-1"
            >
              <MarkSwatch shape={mark.shape} color={mark.color} />
              {mark.label.trim()}
            </li>
          ))}
        </ul>
      )}
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
              aria-label={
                highlightMode === "seats"
                  ? "团体座位在所在区域的位置示意图"
                  : `座位 ${focus.label} 在所在区域的位置示意图`
              }
            >
              {/*
              桌面外框先画，座位盖在上面。世界坐标和座位共用同一个 viewBox，
              不需要另算缩放；桌子数量是"几十"这个量级，不是座位的"上万"，
              多画几十个形状不会碰到下面那条单路径的性能红线（见
              docs/h5-seat-map.md）。不带名称——这张图回答"哪片区域"，不是
              "哪张桌"，且没有地方放图例区分文字和座位。
            */}
              {map.tables?.map((table) =>
                table.shape === "circle" ? (
                  <circle
                    key={`circle-${table.x}-${table.y}-${table.radius}`}
                    cx={table.x}
                    cy={table.y}
                    r={table.radius}
                    fill="none"
                    stroke="var(--color-ink-4)"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <rect
                    key={`rect-${table.x}-${table.y}-${table.width}-${table.height}`}
                    x={table.x - table.width / 2}
                    y={table.y - table.height / 2}
                    width={table.width}
                    height={table.height}
                    rx={Math.min(16, Math.min(table.width, table.height) / 4)}
                    fill="none"
                    stroke="var(--color-ink-4)"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    transform={
                      table.angle
                        ? `rotate(${table.angle} ${table.x} ${table.y})`
                        : undefined
                    }
                  />
                ),
              )}
              {marks.map((mark, index) => (
                <MarkShape
                  // biome-ignore lint/suspicious/noArrayIndexKey: 标注不带标识下发，顺序即身份
                  key={index}
                  mark={enlargeMark(mark, layout.scale)}
                />
              ))}
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
              {highlightMode === "seats" && (
                <>
                  <path
                    d={highlightPath}
                    fill="none"
                    stroke="white"
                    strokeWidth={layout.dotDiameter + 7}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={highlightPath}
                    fill="none"
                    stroke="var(--color-brand)"
                    strokeWidth={layout.dotDiameter + 1}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              )}
            </svg>

            {/*
            标注文字同定位钉：固定屏幕字号、画在 SVG 外面，不加底色。只画进得去
            形状的（横排，或瘦高形状竖排），放不下的已经列在图上方的图例里。
          */}
            {marks.map((mark, index) => {
              const placement = layout.markLabels[index];
              if (
                placement?.mode !== "horizontal" &&
                placement?.mode !== "vertical"
              )
                return null;
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: 标注不带标识下发，顺序即身份
                  key={index}
                  data-mark-label={placement.mode}
                  className={
                    placement.mode === "vertical"
                      ? "-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute text-caption [text-orientation:upright] [writing-mode:vertical-rl]"
                      : "-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute whitespace-nowrap text-caption"
                  }
                  style={{
                    left: `${placement.left}px`,
                    top: `${placement.top}px`,
                    color: markTextColor(mark.color) ?? "var(--color-ink-2)",
                    lineHeight: placement.mode === "vertical" ? 1 : undefined,
                    letterSpacing:
                      placement.mode === "vertical"
                        ? `${MARK_VERTICAL_ADVANCE - 1}em`
                        : undefined,
                  }}
                >
                  {mark.label.trim()}
                </span>
              );
            })}

            {/*
            定位钉是**固定屏幕尺寸**，画在 SVG 外面。一千座的图上圆点只有两三个
            像素，红点要是跟着一起缩，"我在哪"就彻底看不见了——而那是这张图存在
            的唯一理由。位置能用一行乘法算准，靠的是 viewBox 长宽比和盒子完全
            一致（见 seat-map-layout.ts）。
          */}
            {highlightMode === "pin" && (
              <span
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute block h-3 w-3 rounded-full border-2 border-white bg-brand shadow-[0_0_0_0.25rem_rgba(232,68,46,0.25)]"
                style={{
                  left: `${layout.pin.left}px`,
                  top: `${layout.pin.top}px`,
                }}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

/** 同色、同形、同名的标注在图例里只列一次。 */
function legendItems(
  marks: readonly SeatMapMark[],
  layout: SeatMapLayout | null,
) {
  if (!layout) return [];
  const seen = new Set<string>();
  return marks.filter((mark, index) => {
    if (layout.markLabels[index]?.mode !== "legend") return false;
    const key = `${mark.color.toUpperCase()}-${mark.shape}-${mark.label.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function MarkShape({ mark }: { mark: SeatMapMark }) {
  const paint = {
    fill: mark.color,
    fillOpacity: 0.14,
    stroke: mark.color,
    strokeWidth: 1,
    vectorEffect: "non-scaling-stroke",
  } as const;
  if (mark.shape === "ellipse")
    return (
      <ellipse
        cx={mark.x + mark.width / 2}
        cy={mark.y + mark.height / 2}
        rx={mark.width / 2}
        ry={mark.height / 2}
        {...paint}
      />
    );
  if (mark.shape === "polygon" && mark.points)
    return (
      <polygon
        points={mark.points.map((point) => `${point.x},${point.y}`).join(" ")}
        {...paint}
      />
    );
  return (
    <rect
      x={mark.x}
      y={mark.y}
      width={mark.width}
      height={mark.height}
      rx={Math.min(6, mark.width / 4, mark.height / 4)}
      {...paint}
    />
  );
}

/** 图例色块画成标注自己的形状。 */
function MarkSwatch({
  shape,
  color,
}: {
  shape: SeatMapMark["shape"];
  color: string;
}) {
  const paint = {
    fill: color,
    fillOpacity: 0.18,
    stroke: color,
    strokeWidth: 1.5,
  };
  return (
    <svg viewBox="0 0 14 14" className="size-3 shrink-0" aria-hidden="true">
      {shape === "rect" ? (
        <rect x={1.5} y={3} width={11} height={8} rx={1.5} {...paint} />
      ) : shape === "ellipse" ? (
        <circle cx={7} cy={7} r={5.5} {...paint} />
      ) : (
        <polygon points="7,1.5 12.5,5.5 10.5,12 3.5,12 1.5,5.5" {...paint} />
      )}
    </svg>
  );
}

/** 团体高亮同样压成一条 path，避免团体占了几百个位置时造出几百个 DOM 节点。 */
function highlightsToPath(highlights: readonly SeatMapMarker[]) {
  return highlights.map((seat) => `M${seat.x} ${seat.y}h0`).join("");
}
