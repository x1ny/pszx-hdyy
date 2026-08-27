export type OrganizationSeatSelectionMode = "continuous" | "marquee";

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

export type OrganizationSeatSelectionResult = {
  selectedExternalIds: string[];
  skipped: OrganizationSeatSelectionSkip[];
  overflowCount: number;
  insufficient: number;
};

export type ResolveOrganizationSeatSelectionInput = {
  mode: OrganizationSeatSelectionMode;
  targetCount: number;
  zoneExternalId: string;
  requestedExternalIds: readonly string[];
  candidates: readonly OrganizationSeatSelectionCandidate[];
};

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

function emptyResult(targetCount: number): OrganizationSeatSelectionResult {
  return {
    selectedExternalIds: [],
    skipped: [],
    overflowCount: 0,
    insufficient: Math.max(0, targetCount),
  };
}

/**
 * 把画布的一次点击或框选转成团体占位的有序候选位置。
 *
 * 这个函数只决定前端暂存的 selection，绝不直接写入方案；提交时仍由服务端做
 * 事务化的最终可用性校验。ordinal 是唯一的业务排序依据，避免框选方向或 DOM
 * 渲染顺序影响最终批量写入顺序。
 */
export function resolveOrganizationSeatSelection({
  mode,
  targetCount,
  zoneExternalId,
  requestedExternalIds,
  candidates,
}: ResolveOrganizationSeatSelectionInput): OrganizationSeatSelectionResult {
  if (!Number.isSafeInteger(targetCount) || targetCount <= 0) {
    return emptyResult(0);
  }

  const seats = candidates
    .filter((seat) => seat.zoneExternalId === zoneExternalId)
    .sort(stableSeatOrder);
  const requested = new Set(requestedExternalIds);

  if (mode === "continuous") {
    const startId = requestedExternalIds[0];
    const startIndex = seats.findIndex((seat) => seat.externalId === startId);
    if (startIndex === -1) return emptyResult(targetCount);

    const selectedExternalIds: string[] = [];
    const skipped: OrganizationSeatSelectionSkip[] = [];
    for (const seat of seats.slice(startIndex)) {
      if (seat.availability === "available") {
        selectedExternalIds.push(seat.externalId);
        if (selectedExternalIds.length === targetCount) break;
      } else {
        skipped.push(toSkip(seat));
      }
    }
    return {
      selectedExternalIds,
      skipped,
      overflowCount: 0,
      insufficient: Math.max(0, targetCount - selectedExternalIds.length),
    };
  }

  const selectedExternalIds: string[] = [];
  const skipped: OrganizationSeatSelectionSkip[] = [];
  let overflowCount = 0;
  for (const seat of seats) {
    if (!requested.has(seat.externalId)) continue;
    if (seat.availability !== "available") {
      skipped.push(toSkip(seat));
      continue;
    }
    if (selectedExternalIds.length >= targetCount) {
      overflowCount += 1;
      continue;
    }
    selectedExternalIds.push(seat.externalId);
  }
  return {
    selectedExternalIds,
    skipped,
    overflowCount,
    insufficient: Math.max(0, targetCount - selectedExternalIds.length),
  };
}
