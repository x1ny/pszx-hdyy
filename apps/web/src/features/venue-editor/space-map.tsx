import { canvasEditor } from "./canvas";
import type { CanvasDoc, CanvasZone } from "./canvas/core/document";
import { ZoneGeometry } from "./canvas/react/canvas-view";

/**
 * **只读**的区域分布图。活动场地空间页用它把拷贝下来的那份画布画出来。
 *
 * 跟编辑器共用 `ZoneGeometry`，所以矩形/椭圆/多边形和自定义颜色都是真的，
 * 不是原型里那种 CSS 定位的假方块。但它没有任何手势、没有 Command、没有
 * undo——活动层**不做几何编辑**（docs/场地排位底层设计.md §3.3），能改的只有
 * 用途、点位和启用状态，那些在右边的表单里改。
 *
 * 自适应尺寸靠 `viewBox` + `preserveAspectRatio`，不需要 pan/zoom：一个场地
 * 的区域分布整份看得下，缩放在这里没有用武之地。
 */

export function parseSpaceLayout(raw: unknown): CanvasDoc | null {
  return canvasEditor.safeParse(raw);
}

export type SpaceMapZone = {
  externalId: string;
  name: string;
  /** 显示在区域名下面那行小字，通常是「用途 / 点位」。 */
  caption: string;
  disabled: boolean;
};

export function SpaceMap({
  doc,
  zones,
  selectedExternalId,
  onSelect,
}: {
  doc: CanvasDoc;
  /** 区域的**业务信息**来自活动层的行，不是 blob——blob 只提供几何。 */
  zones: SpaceMapZone[];
  selectedExternalId?: string | null;
  onSelect?: (externalId: string) => void;
}) {
  const metaByExternalId = new Map(
    zones.map((zone) => [zone.externalId, zone]),
  );

  // 只画活动层认的区域。blob 里可能有活动导入之后场地库又加的区域——那些不属于
  // 这个活动的空间，画出来会让人以为能用。
  const drawable = doc.zones.filter((zone) =>
    metaByExternalId.has(zone.externalId),
  );

  if (drawable.length === 0) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center text-muted-foreground text-sm">
        这个场地没有可显示的区域
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${doc.world.width} ${doc.world.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label="区域分布图"
    >
      <title>区域分布图</title>
      {drawable.map((zone) => {
        const meta = metaByExternalId.get(zone.externalId);
        if (!meta) return null;
        const selected = zone.externalId === selectedExternalId;
        return (
          <MapZone
            key={zone.externalId}
            zone={zone}
            meta={meta}
            selected={selected}
            onSelect={onSelect}
          />
        );
      })}
    </svg>
  );
}

function MapZone({
  zone,
  meta,
  selected,
  onSelect,
}: {
  zone: CanvasZone;
  meta: SpaceMapZone;
  selected: boolean;
  onSelect?: (externalId: string) => void;
}) {
  const cx = zone.shape.x + zone.shape.width / 2;
  const cy = zone.shape.y + zone.shape.height / 2;

  // 字号跟着世界坐标走，不跟着屏幕像素——viewBox 会整体缩放，用固定 px 的话
  // 大场地里的字会缩成一条线。
  const nameSize = Math.max(16, Math.min(28, zone.shape.height / 6));
  const captionSize = nameSize * 0.7;

  const select = onSelect ? () => onSelect(zone.externalId) : undefined;

  return (
    // 可点击选中，所以要能被键盘和读屏软件当成一个真正的控件，不是套一层
    // onClick 就算数——role/tabIndex/onKeyDown 三个凑齐，Enter/Space 都能触发。
    // 规则不认 SVG <g> 能带交互角色，但这几行已经把它做成一个真正可达的控件，
    // 跟 zone-seating-editor.tsx 的 <svg> 是同一个已知限制。
    // biome-ignore lint/a11y/noStaticElementInteractions: 见上
    <g
      onClick={select}
      onKeyDown={
        select
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                select();
              }
            }
          : undefined
      }
      role={select ? "button" : undefined}
      tabIndex={select ? 0 : undefined}
      aria-label={select ? `选中区域 ${meta.name}` : undefined}
      // 不吃掉默认的键盘焦点框——没有另外画一套 focus-visible 样式，
      // 拿掉默认的话键盘用户就找不到焦点在哪了。
      className={select ? "cursor-pointer" : undefined}
      opacity={meta.disabled ? 0.4 : 1}
    >
      <ZoneGeometry zone={zone} />
      {selected && (
        <rect
          x={zone.shape.x - 3}
          y={zone.shape.y - 3}
          width={zone.shape.width + 6}
          height={zone.shape.height + 6}
          rx={8}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={3}
        />
      )}
      <text
        x={cx}
        y={cy - captionSize * 0.4}
        textAnchor="middle"
        fontSize={nameSize}
        fontWeight={600}
        fill={zone.stroke}
        className="pointer-events-none select-none"
      >
        {meta.name}
      </text>
      <text
        x={cx}
        y={cy + nameSize * 0.8}
        textAnchor="middle"
        fontSize={captionSize}
        fill="var(--muted-foreground)"
        className="pointer-events-none select-none"
      >
        {meta.disabled ? "已禁用" : meta.caption}
      </text>
    </g>
  );
}
