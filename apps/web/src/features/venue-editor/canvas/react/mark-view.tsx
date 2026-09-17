import { memo } from "react";
import type { CanvasMark, ZoneShape } from "../core/document";
import { type Point, pointsToSvg } from "../core/geometry";
import {
  MARK_LABEL_FONT_PX,
  MARK_VERTICAL_ADVANCE,
  markLabelLayout,
  markPoints,
  markTextColor,
} from "../core/marks";

/**
 * 场地标注的画布渲染。形状用画布坐标、跟着缩放；描边和文字按屏幕像素换算
 * （`px()`），跟座位同一条规则，所以缩放时文字大小恒定、形状真的变大变小。
 * 放不下的文字交给 `MarkLegend`，这里不画。
 */
export const MarkNode = memo(function MarkNode({
  mark,
  scale,
  offset,
  selected,
}: {
  mark: CanvasMark;
  /** 屏幕像素 ÷ 画布单位。 */
  scale: number;
  /** 拖动或缩放中的临时位移，不写进文档。 */
  offset?: Point | null;
  selected?: boolean;
}) {
  const px = (value: number) => value / scale;
  const label = markLabelLayout(mark.shape, mark.label, scale);
  const textFill = markTextColor(mark.color) ?? "var(--foreground)";
  const fontSize = px(MARK_LABEL_FONT_PX);
  const chars = [...mark.label.trim()];

  return (
    <g
      data-mark-id={mark.externalId}
      data-mark-label-mode={label.mode}
      transform={offset ? `translate(${offset.x} ${offset.y})` : undefined}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      <MarkShape
        shape={mark.shape}
        fill={mark.color}
        fillOpacity={0.12}
        stroke={mark.color}
        strokeWidth={px(selected ? 2 : 1.5)}
        strokeDasharray={selected ? `${px(5)} ${px(3)}` : undefined}
      />
      {label.mode === "horizontal" && (
        <text
          x={label.x}
          y={label.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={600}
          fill={textFill}
        >
          {mark.label.trim()}
        </text>
      )}
      {label.mode === "vertical" && (
        // 竖排逐字一行：SVG 的 writing-mode 在导出栅格化时各浏览器表现不一，
        // 一字一个 tspan 在画布和导出里都稳定。
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={600}
          fill={textFill}
        >
          {chars.map((char, index) => (
            <tspan
              // biome-ignore lint/suspicious/noArrayIndexKey: 字序即身份
              key={index}
              x={label.x}
              y={
                label.y +
                (index - (chars.length - 1) / 2) *
                  fontSize *
                  MARK_VERTICAL_ADVANCE
              }
            >
              {char}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
});

export function MarkShape({
  shape,
  ...paint
}: {
  shape: ZoneShape;
} & React.SVGAttributes<SVGElement>) {
  switch (shape.type) {
    case "rect":
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={Math.min(6, shape.width / 4, shape.height / 4)}
          {...paint}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={shape.x + shape.width / 2}
          cy={shape.y + shape.height / 2}
          rx={shape.width / 2}
          ry={shape.height / 2}
          {...paint}
        />
      );
    case "polygon":
      return <polygon points={pointsToSvg(markPoints(shape))} {...paint} />;
    default:
      return null;
  }
}

/** 图例色块画成标注自己的形状：同色的矩形和圆也能分开。 */
export function MarkSwatch({
  type,
  color,
}: {
  type: ZoneShape["type"];
  color: string;
}) {
  const paint = {
    fill: color,
    fillOpacity: 0.18,
    stroke: color,
    strokeWidth: 1.5,
  };
  return (
    <svg
      viewBox="0 0 14 14"
      className="size-3.5 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      {type === "rect" ? (
        <rect x={1.5} y={3} width={11} height={8} rx={1.5} {...paint} />
      ) : type === "ellipse" ? (
        <circle cx={7} cy={7} r={5.5} {...paint} />
      ) : (
        <polygon points="7,1.5 12.5,5.5 10.5,12 3.5,12 1.5,5.5" {...paint} />
      )}
    </svg>
  );
}

/**
 * 文字放不进形状的标注，在画布左上角按颜色列出来。浮在画布上方而不是占一行，
 * 缩放时条目增减不会把画布挤得跳动。
 */
export function MarkLegend({
  marks,
  scale,
}: {
  marks: readonly CanvasMark[];
  scale: number;
}) {
  const items = marks.filter(
    (mark) => markLabelLayout(mark.shape, mark.label, scale).mode === "legend",
  );
  if (items.length === 0) return null;
  return (
    <ul
      className="pointer-events-none absolute top-2 left-2 flex max-w-[70%] flex-wrap gap-x-3 gap-y-1 rounded-md border bg-card/90 px-2 py-1 text-xs shadow-sm"
      aria-label="标注图例"
    >
      {items.map((mark) => (
        <li key={mark.externalId} className="flex items-center gap-1">
          <MarkSwatch type={mark.shape.type} color={mark.color} />
          <span>{mark.label.trim()}</span>
        </li>
      ))}
    </ul>
  );
}
