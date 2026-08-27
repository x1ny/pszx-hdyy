export type TripBatchOrganizationOption = { id: number };
export type TripBatchMemberOption = {
  activityMemberId: number;
  organizationId: number | null;
};

export type TripBatchScopeOptions = {
  organizations: readonly TripBatchOrganizationOption[];
  members: readonly TripBatchMemberOption[];
};

export type TripBatchSelection = {
  organizationId: number | null;
  activityMemberIds: number[];
};

export const batchMembersForOrganization = <T extends TripBatchMemberOption>(
  options: { members: readonly T[] },
  organizationId: number | null,
): T[] => {
  if (organizationId === null) return [];
  return options.members.filter(
    (member) => member.organizationId === organizationId,
  );
};

const uniqueIds = (members: readonly TripBatchMemberOption[]) => [
  ...new Set(members.map((member) => member.activityMemberId)),
];

/** 团体变化后默认全选该团体在当前活动/环节范围内的全部合法成员。 */
export const selectBatchOrganization = (
  options: TripBatchScopeOptions,
  organizationId: number | null,
): TripBatchSelection => ({
  organizationId,
  activityMemberIds: uniqueIds(
    batchMembersForOrganization(options, organizationId),
  ),
});

/**
 * 环节变化并拿到新范围后：旧团体仍合法则保留并重新全选；已经不合法则团体和
 * 人员一起清空，不能把活动范围的旧选择带进更窄的环节范围。
 */
export const reconcileBatchScope = (
  previousOrganizationId: number | null,
  options: TripBatchScopeOptions,
): TripBatchSelection => {
  const organizationStillAvailable = options.organizations.some(
    (organization) => organization.id === previousOrganizationId,
  );
  return organizationStillAvailable
    ? selectBatchOrganization(options, previousOrganizationId)
    : { organizationId: null, activityMemberIds: [] };
};

/** 同一范围后台刷新时只剔除失效人员，不把用户刚取消的人重新勾回来。 */
export const synchronizeBatchSelection = (
  selection: TripBatchSelection,
  options: TripBatchScopeOptions,
): TripBatchSelection => {
  const organizationStillAvailable = options.organizations.some(
    (organization) => organization.id === selection.organizationId,
  );
  if (!organizationStillAvailable) {
    return { organizationId: null, activityMemberIds: [] };
  }

  const eligibleIds = new Set(
    uniqueIds(batchMembersForOrganization(options, selection.organizationId)),
  );
  return {
    organizationId: selection.organizationId,
    activityMemberIds: selection.activityMemberIds.filter((id) =>
      eligibleIds.has(id),
    ),
  };
};

export const toggleBatchMember = (
  selectedIds: readonly number[],
  memberId: number,
  checked: boolean,
  eligibleMembers: readonly TripBatchMemberOption[],
) => {
  const next = new Set(selectedIds);
  if (checked) next.add(memberId);
  else next.delete(memberId);
  return uniqueIds(eligibleMembers).filter((id) => next.has(id));
};
