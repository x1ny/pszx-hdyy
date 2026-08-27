import type { OrganizationBatchResult } from "./relation-queries";

export const ORGANIZATION_BATCH_MAX_MEMBERS = 200;

export function initializeOrganizationSelection(
  candidateIds: readonly number[],
  excludedIds: readonly number[],
) {
  const excluded = new Set(excludedIds);
  return new Set(candidateIds.filter((id) => !excluded.has(id)));
}

/** 列表刷新后，把刚刚已经加入范围的人从仍可提交的选择里剔除。 */
export function reconcileOrganizationSelection(
  selected: ReadonlySet<number>,
  excludedIds: readonly number[],
) {
  const excluded = new Set(excludedIds);
  return new Set([...selected].filter((id) => !excluded.has(id)));
}

export function toggleOrganizationSelection(
  selected: ReadonlySet<number>,
  memberId: number,
) {
  const next = new Set(selected);
  if (next.has(memberId)) next.delete(memberId);
  else next.add(memberId);
  return next;
}

export function toggleOrganizationPageSelection(
  selected: ReadonlySet<number>,
  pageIds: readonly number[],
  checked: boolean,
) {
  const next = new Set(selected);
  for (const id of pageIds) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function formatOrganizationBatchSummary(
  result: OrganizationBatchResult,
) {
  return `处理完成：新增 ${result.added} 人，已存在 ${result.existing} 人，跳过 ${result.skipped} 人，发现 ${result.conflict} 条冲突`;
}

const LAYER_LABELS = {
  project: "项目",
  activity: "活动",
  segment: "环节",
} as const;

export function getOrganizationConflictDetails(
  result: OrganizationBatchResult,
) {
  return result.items.flatMap((item) => {
    if (item.conflicts.length === 0) return [];
    const layers = item.conflicts
      .map((conflict) => LAYER_LABELS[conflict.layer])
      .join("、");
    return [`${item.name}：${layers}已有其他团体快照`];
  });
}
