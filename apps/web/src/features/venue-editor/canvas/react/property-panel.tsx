import {
  ArrowLeftIcon,
  LayersIcon,
  LogInIcon,
  SofaIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "#/shared/components/ui/button.tsx";
import { Field, FieldLabel } from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { cn } from "#/shared/lib/utils.ts";
import type { SeatKind, SeatRank, ZoneKind } from "../../contract";
import type { CanvasDoc, CanvasZone } from "../core/document";
import type { Selection } from "../core/interaction";

/**
 * 属性面板。选中什么就显示什么——没有"全部字段都摆出来、大半是灰的"那种面板。
 * 它只发出意图，具体怎么改文档是 Command 的事。
 *
 * v2：拆成两个不再共存的面板——`ZonePropertyPanel` 只在顶层区域分布画布出现，
 * `SeatPropertyPanel` 只在进入区域后的排位画布出现，两个视图不会同时选中
 * 一个区域和一个座位，合成一个组件反而要处理更多"其实用不上"的分支。
 *
 * v2.1：`ZonePropertyPanel` 没选中任何区域时不再是一句空空的提示——那个位置
 * 白白浪费了，而这个场地明明已经有区域列表可以看。改成默认展示所有区域的
 * 一张小表（名称 + 座位数），点一行选中并切到编辑表单；面板宽度全程固定
 * （`PanelShell` 的 `w-72`），两种形态之间只是内容换、外框不跳。
 */

const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  seating: "座席区",
  function: "功能区",
  checkin: "签到区",
  material: "物料区",
};

const SEAT_KIND_LABELS: Record<SeatKind, string> = {
  seat: "座位",
  standing: "站位",
};

const SEAT_RANK_LABELS: Record<SeatRank, string> = {
  normal: "普通",
  vip: "重要",
};

// ---------------------------------------------------------------------------
// 区域属性面板（顶层区域分布画布）
// ---------------------------------------------------------------------------

export type ZonePropertyPanelProps = {
  doc: CanvasDoc;
  selection: Selection;
  onSelectZone: (zoneId: string) => void;
  onClearSelection: () => void;
  onPatchZone: (
    zoneId: string,
    patch: { name?: string; kind?: ZoneKind; fill?: string; stroke?: string },
  ) => void;
  onRemoveZone: (zoneId: string) => void;
  onEnterZone: (zoneId: string) => void;
  /** "进入排位"按钮的文案。活动空间的编辑器复用这个面板但那不是真正的排位
   * （占人），是布置座位几何——调用方按上下文换一句更准确的话，默认还是原话。 */
  enterLabel?: string;
  /**
   * 额外的业务字段插槽，渲染在几何字段和"进入排位"按钮之间。
   *
   * 存在的理由：这个面板只认识 `CanvasZone`（几何 + 名称 + 类型），任何调用方
   * 私有的业务字段（比如活动区域的"活动用途"/"可用点位"）编辑器压根不知道、
   * 也不该知道——那些字段从来不进 blob，是纯粹的核心表列。留一个插槽比让
   * venue-editor 反过来认识"活动"这个概念更干净。
   */
  extra?: (zone: CanvasZone) => React.ReactNode;
};

export function ZonePropertyPanel({
  doc,
  selection,
  onSelectZone,
  onClearSelection,
  onPatchZone,
  onRemoveZone,
  onEnterZone,
  enterLabel = "进入排位",
  extra,
}: ZonePropertyPanelProps) {
  const zone = doc.zones.find(
    (item) => item.externalId === selection.zoneIds[0],
  );

  if (!zone) {
    return (
      <PanelShell>
        <ZoneList
          doc={doc}
          onSelectZone={onSelectZone}
          onEnterZone={onEnterZone}
        />
      </PanelShell>
    );
  }

  const seatCount = doc.seats.filter(
    (seat) => seat.zoneExternalId === zone.externalId,
  ).length;

  return (
    <PanelShell key={zone.externalId}>
      <button
        type="button"
        onClick={onClearSelection}
        className="-mx-1 flex cursor-pointer items-center gap-1 self-start rounded px-1 text-muted-foreground text-xs hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        返回区域列表
      </button>

      <div>
        <h3 className="font-medium text-sm">区域</h3>
        <p className="text-muted-foreground text-xs">
          {Math.round(zone.shape.width)} × {Math.round(zone.shape.height)} ·{" "}
          {seatCount > 0 ? `已排位 ${seatCount} 个座位` : "还没有排位"}
        </p>
      </div>

      <Field>
        <FieldLabel htmlFor="zone-name">名称</FieldLabel>
        <Input
          id="zone-name"
          value={zone.name}
          onChange={(event) =>
            onPatchZone(zone.externalId, { name: event.target.value })
          }
        />
      </Field>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field>
          <FieldLabel>类型</FieldLabel>
          <Select
            items={ZONE_KIND_LABELS}
            value={zone.kind}
            onValueChange={(value) =>
              onPatchZone(zone.externalId, { kind: value as ZoneKind })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ZONE_KIND_LABELS) as ZoneKind[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {ZONE_KIND_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="zone-color">颜色</FieldLabel>
          {/* 原生 color input：不引组件库就有跨浏览器一致的拾色器，
              且天然产出 <input type="color"> 要求的 #rrggbb 格式，跟存储格式一致。 */}
          <input
            id="zone-color"
            type="color"
            value={zone.fill}
            onChange={(event) =>
              onPatchZone(zone.externalId, {
                fill: event.target.value,
                stroke: event.target.value,
              })
            }
            className="h-9 w-11 cursor-pointer rounded-md border bg-transparent p-1"
          />
        </Field>
      </div>

      {extra?.(zone)}

      <Button
        type="button"
        className="w-full"
        onClick={() => onEnterZone(zone.externalId)}
      >
        <LogInIcon />
        {enterLabel}
      </Button>

      <Button
        type="button"
        variant="ghost"
        className="mt-auto text-destructive hover:text-destructive"
        onClick={() => onRemoveZone(zone.externalId)}
      >
        <Trash2Icon />
        删除区域及其位置
      </Button>
    </PanelShell>
  );
}

/**
 * 默认态：所有区域的一张小表。**不用 `shared/components/ui/table.tsx`**——
 * 那份是列表页级别的密度（`px-4 py-3`），塞进 288px 宽的侧栏会把两列都挤爆；
 * 这里的信息量也简单得多（名称 + 座位数），自己写一份更紧凑的 markup。
 */
function ZoneList({
  doc,
  onSelectZone,
  onEnterZone,
}: {
  doc: CanvasDoc;
  onSelectZone: (zoneId: string) => void;
  onEnterZone: (zoneId: string) => void;
}) {
  if (doc.zones.length === 0) {
    return (
      <EmptyHint
        title="还没有区域"
        description="用矩形/椭圆/多边形工具画一个区域，圈出这块空间的形状和用途。"
      />
    );
  }

  const seatCountByZone = new Map<string, number>();
  for (const seat of doc.seats) {
    seatCountByZone.set(
      seat.zoneExternalId,
      (seatCountByZone.get(seat.zoneExternalId) ?? 0) + 1,
    );
  }

  return (
    <>
      <div>
        <h3 className="font-medium text-sm">区域列表</h3>
        <p className="text-muted-foreground text-xs">
          共 {doc.zones.length} 个，点一行查看详情
        </p>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-muted-foreground text-xs">
            <th className="px-1 pb-1.5 text-left font-medium">名称</th>
            <th className="px-1 pb-1.5 text-right font-medium">座位</th>
            <th className="w-7 pb-1.5" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {doc.zones.map((zone) => {
            const count = seatCountByZone.get(zone.externalId) ?? 0;
            return (
              <tr
                key={zone.externalId}
                className="group border-b last:border-0"
              >
                <td className="max-w-0 p-0">
                  <button
                    type="button"
                    onClick={() => onSelectZone(zone.externalId)}
                    className="flex w-full cursor-pointer items-center gap-1.5 px-1 py-1.5 text-left hover:bg-muted/60"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: zone.fill }}
                      aria-hidden
                    />
                    <span className="truncate">{zone.name}</span>
                  </button>
                </td>
                <td className="p-0 text-right">
                  <button
                    type="button"
                    onClick={() => onSelectZone(zone.externalId)}
                    className={cn(
                      "block w-full cursor-pointer px-1 py-1.5 text-right hover:bg-muted/60",
                      count > 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {count > 0 ? count : "—"}
                  </button>
                </td>
                <td className="p-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="进入排位"
                    onClick={() => onEnterZone(zone.externalId)}
                    className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100"
                  >
                    <LogInIcon className="size-3.5" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// 座位属性面板（进入区域之后的排位画布）
// ---------------------------------------------------------------------------

export type SeatPropertyPanelProps = {
  doc: CanvasDoc;
  selection: Selection;
  onPatchSeats: (
    seatIds: string[],
    patch: { kind?: SeatKind; rank?: SeatRank; label?: string },
  ) => void;
  onRemoveSeats: (seatIds: string[]) => void;
};

export function SeatPropertyPanel({
  doc,
  selection,
  onPatchSeats,
  onRemoveSeats,
}: SeatPropertyPanelProps) {
  const seats = doc.seats.filter((item) =>
    selection.seatIds.includes(item.externalId),
  );

  if (seats.length === 0) {
    return (
      <PanelShell>
        <EmptyHint
          icon={SofaIcon}
          title="选中一个位置"
          description="用「点放位置」工具点一下画布新增，或者先套一个布局模板。"
        />
      </PanelShell>
    );
  }

  const ids = seats.map((seat) => seat.externalId);
  const single = seats.length === 1 ? seats[0] : null;

  return (
    <PanelShell>
      <div>
        <h3 className="font-medium text-sm">
          {single ? `位置 ${single.label}` : `已选 ${seats.length} 个位置`}
        </h3>
        <p className="text-muted-foreground text-xs">
          {single ? "改编号只在单选时可用" : "批量修改种类和等级"}
        </p>
      </div>

      {single && (
        <Field>
          <FieldLabel htmlFor="seat-label">编号</FieldLabel>
          <Input
            id="seat-label"
            value={single.label}
            onChange={(event) =>
              onPatchSeats(ids, { label: event.target.value })
            }
          />
        </Field>
      )}

      <Field>
        <FieldLabel>种类</FieldLabel>
        <Select
          items={SEAT_KIND_LABELS}
          value={single?.kind ?? "seat"}
          onValueChange={(value) =>
            onPatchSeats(ids, { kind: value as SeatKind })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SEAT_KIND_LABELS) as SeatKind[]).map((value) => (
              <SelectItem key={value} value={value}>
                {SEAT_KIND_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>等级</FieldLabel>
        <Select
          items={SEAT_RANK_LABELS}
          value={single?.rank ?? "normal"}
          onValueChange={(value) =>
            onPatchSeats(ids, { rank: value as SeatRank })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SEAT_RANK_LABELS) as SeatRank[]).map((value) => (
              <SelectItem key={value} value={value}>
                {SEAT_RANK_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Button
        type="button"
        variant="ghost"
        className="mt-auto text-destructive hover:text-destructive"
        onClick={() => onRemoveSeats(ids)}
      >
        <Trash2Icon />
        删除 {seats.length} 个位置
      </Button>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------

/** 固定宽度——列表态和表单态切换时外框不跳，只有里面的内容在换。 */
function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-4 shadow-sm">
      {children}
    </aside>
  );
}

function EmptyHint({
  icon: Icon = LayersIcon,
  title,
  description,
}: {
  icon?: typeof LayersIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <Icon className="size-8 opacity-40" />
      <p className="text-sm">{title}</p>
      <p className="text-xs">{description}</p>
    </div>
  );
}
