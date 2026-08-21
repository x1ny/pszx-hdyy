import { canvasEditor } from "./canvas";
import {
  type CanvasDoc,
  type CanvasSeat,
  type CanvasZone,
  ZONE_KIND_DEFAULT_COLOR,
} from "./canvas/core/document";
import type { SeatKind, SeatRank, ZoneKind } from "./contract";

/**
 * 从活动场地空间的画布里**切出一块区域**，做成环节排位方案自己的文档。
 *
 * 这个函数是"服务端不解析 blob"这条不变量的直接后果：活动区域的座位躺在那份
 * 不透明的画布数据里，只有前端的编辑器认识它的格式。所以"建方案时把区域的
 * 座位复制过来"这件事，必须发生在前端——服务端收到的是已经投影好的座位清单，
 * 跟 `venue/saveLayout` 收到的是同一种东西。
 *
 * 切出来的文档是**自足**的：区域挪到原点、世界尺寸就是区域尺寸。座位的 x/y
 * 本来就存相对区域左上角的坐标，所以一个字都不用改。之后这份文档跟上游再无
 * 关系——上游底图怎么改，都改不坏已经建好的方案（底层设计 §3.3）。
 */

export type PlanSeatDraft = {
  externalId: string;
  sourceExternalId: string | null;
  label: string;
  kind: SeatKind;
  rank: SeatRank;
  enabled: boolean;
  ordinal: number;
};

export type PlanDocBundle = {
  doc: CanvasDoc;
  seats: PlanSeatDraft[];
};

/** 源场地没画过平面图时，给个能用的空区域，用户进去套模板就能排。 */
const FALLBACK_SIZE = { width: 900, height: 600 };

export function buildPlanDoc(input: {
  /** 活动场地的画布 blob，没有就传 null。 */
  layoutData: unknown;
  zoneExternalId: string;
  zoneName: string;
  zoneKind: ZoneKind;
}): PlanDocBundle {
  const source = input.layoutData
    ? canvasEditor.safeParse(input.layoutData)
    : null;
  const sourceZone = source?.zones.find(
    (zone) => zone.externalId === input.zoneExternalId,
  );

  const color = ZONE_KIND_DEFAULT_COLOR[input.zoneKind];

  // 区域挪到原点：方案的世界就是这块区域本身，没有"区域在场地里的位置"这层
  // 换算。ZoneSeatingEditor 本来就按这个前提工作。
  const zone: CanvasZone = sourceZone
    ? { ...sourceZone, shape: { ...sourceZone.shape, x: 0, y: 0 } }
    : {
        externalId: input.zoneExternalId,
        name: input.zoneName,
        kind: input.zoneKind,
        ordinal: 0,
        shape: { type: "rect", x: 0, y: 0, ...FALLBACK_SIZE },
        fill: color.fill,
        stroke: color.stroke,
      };

  const seats: CanvasSeat[] = (source?.seats ?? []).filter(
    (seat) => seat.zoneExternalId === input.zoneExternalId,
  );

  const doc: CanvasDoc = {
    schemaVersion: 1,
    world: { width: zone.shape.width, height: zone.shape.height },
    zones: [zone],
    seats,
  };

  return { doc, seats: projectPlanSeats(doc) };
}

/**
 * 把方案文档投影成服务端要的座位清单。
 *
 * 跟 `projectCanvas` 的差别只有两处：多一个 `enabled`（本环节启不启用，这是
 * 方案层才有的概念），以及 `sourceExternalId` 记下它是从哪个底图位置复制来的。
 * 坐标依然一个都不往外带。
 */
export function projectPlanSeats(
  doc: CanvasDoc,
  previous?: Map<string, { enabled: boolean; sourceExternalId: string | null }>,
): PlanSeatDraft[] {
  return doc.seats.map((seat) => {
    const prior = previous?.get(seat.externalId);
    return {
      externalId: seat.externalId,
      /**
       * 第一次复制时 externalId 就是来源。之后再保存要沿用**已经记下来的**那个
       * ——不能每次都拿当前 externalId 当来源，那样方案里新加的座位会假装自己
       * 来自底图。
       */
      sourceExternalId: prior ? prior.sourceExternalId : seat.externalId,
      label: seat.label,
      kind: seat.kind,
      rank: seat.rank,
      // 编辑器不认识 enabled（它是方案层概念），所以保存时从库里那份沿用；
      // 新加的座位默认启用。
      enabled: prior?.enabled ?? true,
      ordinal: seat.ordinal,
    };
  });
}
