/**
 * 场地编辑器契约。docs/场地排位底层设计.md §4 的代码落点。
 *
 * 整份设计压在一条分界线上：**核心存"有哪些位置、叫什么、什么性质"，编辑器存
 * "长什么样、在哪里"**。编辑器把自己那套私有格式整份塞进 `layout.data`（服务端
 * 一个字节都不解析），同时通过 `project()` 吐出核心认识的区域和位置。
 *
 * 换编辑器 = 换一个实现这个接口的对象，核心表、状态机、权限、级联规则一行不改。
 */

export const ZONE_KINDS = [
  "seating",
  "function",
  "checkin",
  "material",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/**
 * 位置种类只有能坐人的两种。桌台、舞台、绿植这些没有任何东西会引用，
 * 属于"长什么样"，留在 `layout.data` 里由渲染器画，不进核心表。
 */
export const SEAT_KINDS = ["seat", "standing"] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];

export const SEAT_RANKS = ["normal", "vip"] as const;
export type SeatRank = (typeof SEAT_RANKS)[number];

export type ZoneDraft = {
  /** 编辑器自己生成的稳定标识，只用来在下次保存时做增删改归并。 */
  externalId: string;
  name: string;
  kind: ZoneKind;
  ordinal: number;
};

export type SeatDraft = {
  externalId: string;
  zoneExternalId: string;
  /** 位置编号，形如 A1 / 3桌2号。 */
  label: string;
  kind: SeatKind;
  rank: SeatRank;
  ordinal: number;
};

export type VenueProjection = {
  zones: ZoneDraft[];
  seats: SeatDraft[];
};

/**
 * 契约里**没有** `render`。
 *
 * 按 §4 的完整设计它应该有一个，但那是为"多个编辑器共存、按 rendererKind 分发"
 * 准备的。现在只有一个实现，页面直接把 UI 写在路由里最省；加一个没人分发的
 * `render` 只是把组件多绕一层。等第二个编辑器（SVG 画布）落地、真的需要
 * registry 时再补——那时它有明确的调用方。
 */
export type LayoutEditor<TData> = {
  /** 写进 `layout.rendererKind`，决定下次用哪个实现打开。 */
  readonly kind: string;
  readonly version: number;
  /** 菜单和空状态里显示的名字。 */
  readonly title: string;

  /** 新建场地时的空文档。 */
  createEmpty(): TData;

  /**
   * jsonb 取出来是 `unknown`，解不出来就返回 null，页面转降级视图。
   * 不做版本迁移——换编辑器时老 blob 不迁移，靠 kind 共存。
   */
  safeParse(raw: unknown): TData | null;

  /** 编辑器私有格式 → 核心语义。整份设计的枢纽，也是唯一的出口。 */
  project(data: TData): VenueProjection;
};

/**
 * 保存前的自检，作用在**投影结果**上而不是某个编辑器的私有文档上——所以每个
 * 编辑器实现共用这一份，规则不会各写各的。
 *
 * 服务端会再校验一遍（那才是权威），这份只让用户在点保存之前就看到问题。
 */
export function validateProjection(projection: VenueProjection): string[] {
  const issues: string[] = [];

  const zoneIds = new Set<string>();
  const zoneNames = new Set<string>();
  for (const zone of projection.zones) {
    if (!zone.name.trim()) issues.push("有区域没填名称");
    if (zoneNames.has(zone.name)) issues.push(`区域名称重复：${zone.name}`);
    zoneNames.add(zone.name);
    zoneIds.add(zone.externalId);
  }

  // 同区域内编号不能撞，跨区域可以（A 区和 B 区都能有 A1）。这条规则数据库上
  // 刻意没建约束——编号对调是合法操作，会撞逐语句检查——所以守在这里。
  const labelsByZone = new Map<string, Set<string>>();
  for (const seat of projection.seats) {
    if (!seat.label.trim()) issues.push("有位置没填编号");
    if (!zoneIds.has(seat.zoneExternalId)) {
      issues.push(`位置 ${seat.label} 所属的区域已被删除`);
      continue;
    }
    const labels = labelsByZone.get(seat.zoneExternalId) ?? new Set<string>();
    if (labels.has(seat.label)) {
      issues.push(`同一区域内编号重复：${seat.label}`);
    }
    labels.add(seat.label);
    labelsByZone.set(seat.zoneExternalId, labels);
  }

  return issues;
}

/**
 * `project()` 的硬要求：同一份 data 两次投影出的 `externalId` 必须一致。
 * 否则每次保存都会被归并算法判成"删掉全部旧的、插入全部新的"。
 * 每个编辑器实现都要有一条单测钉住这一点。
 */
export function isProjectionStable<TData>(
  editor: LayoutEditor<TData>,
  data: TData,
): boolean {
  const a = editor.project(data);
  const b = editor.project(data);

  const ids = (p: VenueProjection) => [
    ...p.zones.map((z) => z.externalId),
    ...p.seats.map((s) => s.externalId),
  ];

  return JSON.stringify(ids(a)) === JSON.stringify(ids(b));
}
