export type OrganizationSeatSelectionCandidate = {
  externalId: string;
  label: string;
  ordinal: number;
  zoneExternalId: string;
  availability: "available" | "disabled" | "occupied";
};

export type OrganizationSeatSelectionSkip = {
  externalId: string;
  label: string;
  reason: Exclude<
    OrganizationSeatSelectionCandidate["availability"],
    "available"
  >;
};

/**
 * 一次画布动作要怎么改这份选择。
 *
 * - `toggle`：点中一个位置。已选就取消，未选就选上——checkbox 的语义。
 * - `add`：框选一片。框内可用的**并进**当前选择，不动框外的，也不取消框内已选的。
 * - `sync`：不带任何请求，只把当前选择按最新可用性过滤一遍（数据刷新后用）。
 */
export type OrganizationSeatPickAction = "toggle" | "add" | "sync";

export type ResolveOrganizationSeatPickInput = {
  action: OrganizationSeatPickAction;
  zoneExternalId: string;
  /** `toggle` 时是被点中的那一个，`add` 时是框内命中的全部，`sync` 时为空。 */
  requestedExternalIds: readonly string[];
  /** 当前已选。顺序无所谓——输出一律按 ordinal 重排。 */
  currentExternalIds: readonly string[];
  candidates: readonly OrganizationSeatSelectionCandidate[];
};

export type OrganizationSeatPickResult = {
  selectedExternalIds: string[];
  /** **本次动作**里被挡下的位置，用于一次性提示；不进选择，也不累积。 */
  rejected: OrganizationSeatSelectionSkip[];
  /** 本次因为可用性变化而被移出选择的位置（只有 `sync` 会产生）。 */
  dropped: OrganizationSeatSelectionSkip[];
};

/**
 * 选择的稳定顺序。ordinal 是唯一的业务排序依据，避免框选方向或 DOM 渲染顺序
 * 影响最终批量写入顺序。
 *
 * 后两级不是装饰：`addSeat` 用「当前区域座位数」当 ordinal，而 `removeSeats`
 * 不重排，所以「删中间一个再补一个」会产生**重复 ordinal**。真撞上时按 label
 * 的中文序、再按 externalId 兜底，至少保证同一份数据每次排出来一样。
 */
function stableSeatOrder(
  left: OrganizationSeatSelectionCandidate,
  right: OrganizationSeatSelectionCandidate,
) {
  return (
    left.ordinal - right.ordinal ||
    left.label.localeCompare(right.label, "zh-CN") ||
    left.externalId.localeCompare(right.externalId)
  );
}

function toSkip(
  seat: OrganizationSeatSelectionCandidate,
): OrganizationSeatSelectionSkip {
  if (seat.availability === "available") {
    throw new Error("可用位置不应记入跳过结果");
  }
  return {
    externalId: seat.externalId,
    label: seat.label,
    reason: seat.availability,
  };
}

/**
 * 把画布上的一次点击或框选并进团体占位的选择集。
 *
 * 这个函数只决定前端暂存的 selection，绝不直接写入方案；提交时仍由服务端做
 * 事务化的最终可用性校验。
 *
 * **没有目标数量这个概念**——选几个由操作者自己决定，可以少于团体人数、也可以
 * 多于。早先这里按「剩余人数」自动向后取 N 个，那套自动挑选既跨排跨桌、又没法
 * 补选，实际用起来只能整段重来。
 */
export function resolveOrganizationSeatPick({
  action,
  zoneExternalId,
  requestedExternalIds,
  currentExternalIds,
  candidates,
}: ResolveOrganizationSeatPickInput): OrganizationSeatPickResult {
  const seats = candidates.filter(
    (seat) => seat.zoneExternalId === zoneExternalId,
  );
  const byId = new Map(seats.map((seat) => [seat.externalId, seat]));

  // 先把当前选择按最新可用性过一遍：并发抢座、或者操作者自己在别处停用了位置
  // 之后，选择集里可能躺着已经不能写的位置，不该带到提交那一步才被服务端挡回。
  const selected = new Set<string>();
  const dropped: OrganizationSeatSelectionSkip[] = [];
  for (const externalId of currentExternalIds) {
    const seat = byId.get(externalId);
    if (!seat) continue;
    if (seat.availability === "available") selected.add(externalId);
    else dropped.push(toSkip(seat));
  }

  const rejected: OrganizationSeatSelectionSkip[] = [];
  const rejectedIds = new Set<string>();
  const reject = (seat: OrganizationSeatSelectionCandidate) => {
    if (rejectedIds.has(seat.externalId)) return;
    rejectedIds.add(seat.externalId);
    rejected.push(toSkip(seat));
  };

  if (action === "toggle") {
    const seat = byId.get(requestedExternalIds[0] ?? "");
    if (seat) {
      if (selected.has(seat.externalId)) selected.delete(seat.externalId);
      else if (seat.availability === "available") selected.add(seat.externalId);
      else reject(seat);
    }
  } else if (action === "add") {
    for (const externalId of requestedExternalIds) {
      const seat = byId.get(externalId);
      if (!seat) continue;
      if (selected.has(externalId)) continue;
      if (seat.availability === "available") selected.add(externalId);
      else reject(seat);
    }
  }

  return {
    selectedExternalIds: seats
      .filter((seat) => selected.has(seat.externalId))
      .sort(stableSeatOrder)
      .map((seat) => seat.externalId),
    rejected,
    dropped,
  };
}
