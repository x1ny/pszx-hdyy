import type { Segment } from "#/features/agenda/queries";
import type { PickedMember } from "#/features/member/member-picker-dialog.tsx";
import type {
  NewMemberFields,
  SEGMENT_MEMBER_ROLE_VALUES,
} from "#/features/member/relation-queries.ts";
import { toDateTimeLocalValue } from "#/features/project/utils";
import { RESOURCE_TYPE_VALUES } from "#/features/resource/labels.ts";
import type {
  ActivityResource,
  DemandHandling,
  ResourceType,
  TransportScene,
} from "#/features/resource/queries.ts";
import type {
  ConfigMember,
  SaveSegmentConfigValues,
  SegmentConfig,
} from "./-queries";

/**
 * 环节配置页的草稿模型。
 *
 * 整页原子保存意味着页面上四块的改动全部先落在这里，点保存时才一次性交出去。
 * 这个文件是**纯的**——没有 React、没有请求——因为它承载了整页最容易出错的
 * 两件事：把"用户动过什么"翻译成后端要的**意图**，以及给还没有 id 的对象
 * 分配临时标识。这两件事写错都不会报错，只会静默少存或多删一条，所以它们
 * 必须能被单测钉住。
 *
 * ⚠️ 核心约定：**人员和绑定发意图，不发目标状态。**
 *
 * 如果发的是完整名单、让服务端改成一致，那么运营 A 开着页面去开会的 20 分钟
 * 里，B 用旧弹窗加了个人，A 一保存就会把 B 加的人静默删掉——因为那个人不在
 * A 的名单里。新旧两套界面要并存，这条就是前提。资源需求是唯一的例外，它是
 * 四个格子的矩阵，页面永远拥有完整视野，整体替换才是对的。
 */

// ---------------------------------------------------------------------------
// 草稿形状
// ---------------------------------------------------------------------------

export type BaseDraft = {
  name: string;
  segmentType: Segment["segmentType"];
  /** "main" | "new" | String(lineId)——同旧表单，Select 的值本来就是字符串。 */
  lineKey: string;
  newLineName: string;
  startTime: string;
  endTime: string;
  locationText: string;
  ownerName: string;
  description: string;
  memberEnabled: boolean;
  seatingEnabled: boolean;
};

/** 环节身份。"" 是选择器里的「请选择」，服务端会收敛成 null。 */
export type SegmentRoleDraft = (typeof SEGMENT_MEMBER_ROLE_VALUES)[number] | "";

export type MemberDraft = {
  /** 稳定的 React key，同时是绑定引用这个人的方式。 */
  key: string;
  /** 已保存的环节关系 id；草稿里新加的人为 null。 */
  relationId: number | null;
  /** 已保存的人才有；绑定要用它。 */
  activityMemberId: number | null;
  /** 从人员库选的人有；手动录入的在保存前还没有主档。 */
  memberId: number | null;
  /** 手动录入时填的主档字段。 */
  newMember: NewMemberDraft | null;
  name: string;
  gender: string | null;
  mobile: string | null;
  companyPosition: string | null;
  source: string | null;
  groupName: string | null;
  ownerName: string | null;
  segmentRole: SegmentRoleDraft;
  /** 保存时的原值，用来判断这一行的身份是否真的改过。 */
  savedRole: SegmentRoleDraft | null;
};

/** 手动录入的表单态：全部字符串，空串表示没填，提交时收敛。 */
export type NewMemberDraft = {
  name: string;
  gender: NonNullable<NewMemberFields["gender"]> | "";
  companyPosition: string;
  mobile: string;
  idType: NonNullable<NewMemberFields["idType"]> | "";
  idNumber: string;
  remark: string;
};

export type ResourceFieldsDraft = {
  transportScene: TransportScene | "";
  name: string;
  quantity: string;
  startTime: string;
  endTime: string;
  location: string;
  vehicleInfo: string;
  driverName: string;
  driverPhone: string;
  ownerName: string;
  remark: string;
};

export type BindingDraft = {
  key: string;
  /** 已保存的绑定记录 id；草稿里新绑的为 null。 */
  bindingId: number | null;
  /** 指向 MemberDraft.key——草稿里刚加的人还没有 activityMemberId。 */
  memberKey: string | null;
  activityMemberId: number | null;
  name: string;
  /**
   * 这个人是否在本环节。false 的是"来自其他环节"，标灰、不可在此移除——
   * 环节页只看得到本环节的人，让它去动别人的绑定就是越界。
   */
  inSegment: boolean;
};

export type ResourceDraft = {
  key: string;
  /** 已保存的资源 id；草稿里新建的为 null。 */
  resourceId: number | null;
  fields: ResourceFieldsDraft;
  /** 载入时的字段快照，用来判断这条已有资源本次是否真的被改过。 */
  savedFields: ResourceFieldsDraft | null;
  bindings: BindingDraft[];
  /** 本次要解除的绑定记录 id。 */
  removedBindingIds: number[];
};

export type DemandDraft = {
  resourceType: ResourceType;
  enabled: boolean;
  handling: DemandHandling;
  description: string;
  estimatedCount: string;
  ownerName: string;
  resources: ResourceDraft[];
  /** 解除关联：资源留在台账里，只是不再服务这条需求。 */
  unlinkResourceIds: number[];
  /** 作废：活动级的报废动作，有二次确认。 */
  voidResourceIds: number[];
};

export type ConfigDraft = {
  base: BaseDraft;
  members: MemberDraft[];
  /** 从已保存名单里移除的环节关系 id。 */
  removedRelationIds: number[];
  demands: DemandDraft[];
  /** 只增不减的计数器，用来生成 tempKey。 */
  nextKey: number;
};

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

export const emptyResourceFields = (): ResourceFieldsDraft => ({
  transportScene: "",
  name: "",
  quantity: "",
  startTime: "",
  endTime: "",
  location: "",
  vehicleInfo: "",
  driverName: "",
  driverPhone: "",
  ownerName: "",
  remark: "",
});

export const emptyNewMember = (): NewMemberDraft => ({
  name: "",
  gender: "",
  companyPosition: "",
  mobile: "",
  idType: "",
  idNumber: "",
  remark: "",
});

const emptyDemand = (resourceType: ResourceType): DemandDraft => ({
  resourceType,
  enabled: false,
  handling: "arrange",
  description: "",
  estimatedCount: "",
  ownerName: "",
  resources: [],
  unlinkResourceIds: [],
  voidResourceIds: [],
});

/** 新建环节时的空草稿。四类需求都先摆出来（enabled=false），开关一勾就能填。 */
export function createEmptyDraft(defaults?: Partial<BaseDraft>): ConfigDraft {
  return {
    base: {
      name: "",
      segmentType: "other",
      lineKey: "main",
      newLineName: "",
      startTime: "",
      endTime: "",
      locationText: "",
      ownerName: "",
      description: "",
      memberEnabled: false,
      seatingEnabled: false,
      ...defaults,
    },
    members: [],
    removedRelationIds: [],
    demands: RESOURCE_TYPE_VALUES.map(emptyDemand),
    nextKey: 1,
  };
}

const toResourceFields = (
  resource: SegmentConfig["demands"][number]["resources"][number],
): ResourceFieldsDraft => ({
  transportScene: resource.transportScene ?? "",
  name: resource.name,
  quantity: resource.quantity === null ? "" : String(resource.quantity),
  startTime: toDateTimeLocalValue(resource.startTime ?? undefined),
  endTime: toDateTimeLocalValue(resource.endTime ?? undefined),
  location: resource.location ?? "",
  vehicleInfo: resource.vehicleInfo ?? "",
  driverName: resource.driverName ?? "",
  driverPhone: resource.driverPhone ?? "",
  ownerName: resource.ownerName ?? "",
  remark: resource.remark ?? "",
});

const toMemberDraft = (row: ConfigMember): MemberDraft => ({
  key: `s${row.id}`,
  relationId: row.id,
  activityMemberId: row.activityMemberId,
  memberId: row.memberId,
  newMember: null,
  name: row.name,
  gender: row.gender,
  mobile: row.mobile,
  companyPosition: row.companyPosition,
  source: row.source,
  groupName: row.groupName,
  ownerName: row.ownerName,
  segmentRole: row.segmentRole ?? "",
  savedRole: row.segmentRole,
});

/** 从接口返回的配置建草稿。编辑态的入口。 */
export function draftFromConfig(
  config: SegmentConfig,
  lineKey: string,
): ConfigDraft {
  const byType = new Map(
    config.demands.map((demand) => [demand.resourceType, demand] as const),
  );

  return {
    base: {
      name: config.segment.name,
      segmentType: config.segment.segmentType,
      lineKey,
      newLineName: "",
      startTime: toDateTimeLocalValue(config.segment.startTime),
      endTime: toDateTimeLocalValue(config.segment.endTime),
      locationText: config.segment.locationText ?? "",
      ownerName: config.segment.ownerName ?? "",
      description: config.segment.description ?? "",
      memberEnabled: config.segment.memberEnabled,
      seatingEnabled: config.segment.seatingEnabled,
    },
    members: config.members.map(toMemberDraft),
    removedRelationIds: [],
    demands: RESOURCE_TYPE_VALUES.map((resourceType) => {
      const saved = byType.get(resourceType);
      if (!saved) return emptyDemand(resourceType);

      return {
        resourceType,
        // 行存在即已开启——需求项没有 enabled 列，关掉就是删行。
        enabled: true,
        handling: saved.handling,
        description: saved.description ?? "",
        estimatedCount:
          saved.estimatedCount === null ? "" : String(saved.estimatedCount),
        ownerName: saved.ownerName ?? "",
        resources: saved.resources.map((resource) => {
          const fields = toResourceFields(resource);
          return {
            key: `r${resource.id}`,
            resourceId: resource.id,
            fields,
            savedFields: fields,
            bindings: resource.bindings.map((binding) => ({
              key: `b${binding.id}`,
              bindingId: binding.id,
              memberKey: null,
              activityMemberId: binding.activityMemberId,
              name: binding.name,
              inSegment: binding.inSegment,
            })),
            removedBindingIds: [],
          };
        }),
        unlinkResourceIds: [],
        voidResourceIds: [],
      };
    }),
    nextKey: 1,
  };
}

// ---------------------------------------------------------------------------
// 草稿操作
// ---------------------------------------------------------------------------

const nextKey = (draft: ConfigDraft, prefix: string) =>
  [`${prefix}${draft.nextKey}`, draft.nextKey + 1] as const;

/** 从人员库选人加进草稿。已在名单里的跳过——重复添加没有意义。 */
export function addPickedMembers(
  draft: ConfigDraft,
  rows: readonly PickedMember[],
): ConfigDraft {
  const known = new Set(
    draft.members
      .map((row) => row.memberId)
      .filter((id): id is number => id !== null),
  );

  let counter = draft.nextKey;
  const added: MemberDraft[] = [];
  for (const row of rows) {
    if (known.has(row.id)) continue;
    known.add(row.id);
    added.push({
      key: `n${counter}`,
      relationId: null,
      activityMemberId: null,
      memberId: row.id,
      newMember: null,
      name: row.name,
      gender: null,
      mobile: row.mobile ?? null,
      companyPosition: row.companyPosition ?? null,
      source: null,
      groupName: null,
      ownerName: null,
      segmentRole: "",
      savedRole: null,
    });
    counter += 1;
  }

  return {
    ...draft,
    members: [...draft.members, ...added],
    nextKey: counter,
  };
}

/** 手动录入一个新人。主档在保存时才建（ladder 保证"先主档后关系"）。 */
export function addManualMember(
  draft: ConfigDraft,
  member: NewMemberDraft,
): ConfigDraft {
  const [key, counter] = nextKey(draft, "n");
  return {
    ...draft,
    members: [
      ...draft.members,
      {
        key,
        relationId: null,
        activityMemberId: null,
        memberId: null,
        newMember: member,
        name: member.name,
        gender: member.gender || null,
        mobile: member.mobile || null,
        companyPosition: member.companyPosition || null,
        source: null,
        groupName: null,
        ownerName: null,
        segmentRole: "",
        savedRole: null,
      },
    ],
    nextKey: counter,
  };
}

/**
 * 从草稿里移除一个人，并把他在本页资源上的**草稿绑定**一并撤掉。
 *
 * 只撤草稿绑定（bindingId 为 null 的那些）——已保存的绑定属于活动级数据，
 * 一个人不参加这个环节了不代表他不坐那辆车。已保存的绑定会在下次载入时以
 * "来自其他环节"的灰行出现，这是对的。
 */
export function removeMember(draft: ConfigDraft, key: string): ConfigDraft {
  const target = draft.members.find((row) => row.key === key);
  if (!target) return draft;

  return {
    ...draft,
    members: draft.members.filter((row) => row.key !== key),
    removedRelationIds:
      target.relationId === null
        ? draft.removedRelationIds
        : [...draft.removedRelationIds, target.relationId],
    demands: draft.demands.map((demand) => ({
      ...demand,
      resources: demand.resources.map((resource) => ({
        ...resource,
        bindings: resource.bindings.filter(
          (binding) => binding.bindingId !== null || binding.memberKey !== key,
        ),
      })),
    })),
  };
}

export function setMemberRole(
  draft: ConfigDraft,
  key: string,
  segmentRole: SegmentRoleDraft,
): ConfigDraft {
  return {
    ...draft,
    members: draft.members.map((row) =>
      row.key === key ? { ...row, segmentRole } : row,
    ),
  };
}

const mapDemand = (
  draft: ConfigDraft,
  resourceType: ResourceType,
  update: (demand: DemandDraft) => DemandDraft,
): ConfigDraft => ({
  ...draft,
  demands: draft.demands.map((demand) =>
    demand.resourceType === resourceType ? update(demand) : demand,
  ),
});

export function setDemandField<K extends keyof DemandDraft>(
  draft: ConfigDraft,
  resourceType: ResourceType,
  field: K,
  value: DemandDraft[K],
): ConfigDraft {
  return mapDemand(draft, resourceType, (demand) => ({
    ...demand,
    [field]: value,
  }));
}

export function addNewResource(
  draft: ConfigDraft,
  resourceType: ResourceType,
): ConfigDraft {
  const [key, counter] = nextKey(draft, "nr");
  return {
    ...mapDemand(draft, resourceType, (demand) => ({
      ...demand,
      resources: [
        ...demand.resources,
        {
          key,
          resourceId: null,
          fields: emptyResourceFields(),
          savedFields: null,
          bindings: [],
          removedBindingIds: [],
        },
      ],
    })),
    nextKey: counter,
  };
}

/** 关联一条已有的台账资源。已经挂着的跳过，避免同一条出现两遍。 */
export function linkExistingResource(
  draft: ConfigDraft,
  resourceType: ResourceType,
  resource: ActivityResource,
): ConfigDraft {
  return mapDemand(draft, resourceType, (demand) => {
    if (demand.resources.some((row) => row.resourceId === resource.id)) {
      return demand;
    }

    const fields: ResourceFieldsDraft = {
      ...emptyResourceFields(),
      transportScene: resource.transportScene ?? "",
      name: resource.name,
      quantity: resource.quantity === null ? "" : String(resource.quantity),
      startTime: toDateTimeLocalValue(resource.startTime ?? undefined),
      endTime: toDateTimeLocalValue(resource.endTime ?? undefined),
      location: resource.location ?? "",
      vehicleInfo: resource.vehicleInfo ?? "",
      driverName: resource.driverName ?? "",
      driverPhone: resource.driverPhone ?? "",
      ownerName: resource.ownerName ?? "",
      remark: resource.remark ?? "",
    };

    return {
      ...demand,
      // 从"本次要解除"里划掉：先解除又重新关联，等于什么都没做。
      unlinkResourceIds: demand.unlinkResourceIds.filter(
        (id) => id !== resource.id,
      ),
      resources: [
        ...demand.resources,
        {
          key: `r${resource.id}`,
          resourceId: resource.id,
          fields,
          savedFields: fields,
          bindings: [],
          removedBindingIds: [],
        },
      ],
    };
  });
}

export function setResourceField(
  draft: ConfigDraft,
  resourceType: ResourceType,
  key: string,
  field: keyof ResourceFieldsDraft,
  value: string,
): ConfigDraft {
  return mapDemand(draft, resourceType, (demand) => ({
    ...demand,
    resources: demand.resources.map((resource) =>
      resource.key === key
        ? { ...resource, fields: { ...resource.fields, [field]: value } }
        : resource,
    ),
  }));
}

/** 从这条需求下移除一条资源安排：已保存的记为"解除关联"，草稿的直接丢掉。 */
export function detachResource(
  draft: ConfigDraft,
  resourceType: ResourceType,
  key: string,
): ConfigDraft {
  return mapDemand(draft, resourceType, (demand) => {
    const target = demand.resources.find((row) => row.key === key);
    if (!target) return demand;

    return {
      ...demand,
      resources: demand.resources.filter((row) => row.key !== key),
      unlinkResourceIds:
        target.resourceId === null
          ? demand.unlinkResourceIds
          : [...demand.unlinkResourceIds, target.resourceId],
    };
  });
}

/** 作废一条资源。它是活动级的报废，和"解除关联"是两件事。 */
export function voidResource(
  draft: ConfigDraft,
  resourceType: ResourceType,
  key: string,
): ConfigDraft {
  return mapDemand(draft, resourceType, (demand) => {
    const target = demand.resources.find((row) => row.key === key);
    if (!target || target.resourceId === null) return demand;

    return {
      ...demand,
      resources: demand.resources.filter((row) => row.key !== key),
      voidResourceIds: [...demand.voidResourceIds, target.resourceId],
    };
  });
}

export function bindMemberToResource(
  draft: ConfigDraft,
  resourceType: ResourceType,
  resourceKey: string,
  member: MemberDraft,
): ConfigDraft {
  const [key, counter] = nextKey(draft, "nb");
  return {
    ...mapDemand(draft, resourceType, (demand) => ({
      ...demand,
      resources: demand.resources.map((resource) => {
        if (resource.key !== resourceKey) return resource;
        const already = resource.bindings.some(
          (binding) =>
            (member.activityMemberId !== null &&
              binding.activityMemberId === member.activityMemberId) ||
            binding.memberKey === member.key,
        );
        if (already) return resource;

        return {
          ...resource,
          bindings: [
            ...resource.bindings,
            {
              key,
              bindingId: null,
              memberKey: member.key,
              activityMemberId: member.activityMemberId,
              name: member.name,
              inSegment: true,
            },
          ],
        };
      }),
    })),
    nextKey: counter,
  };
}

export function unbindMemberFromResource(
  draft: ConfigDraft,
  resourceType: ResourceType,
  resourceKey: string,
  bindingKey: string,
): ConfigDraft {
  return mapDemand(draft, resourceType, (demand) => ({
    ...demand,
    resources: demand.resources.map((resource) => {
      if (resource.key !== resourceKey) return resource;
      const target = resource.bindings.find((row) => row.key === bindingKey);
      if (!target || !target.inSegment) return resource;

      return {
        ...resource,
        bindings: resource.bindings.filter((row) => row.key !== bindingKey),
        removedBindingIds:
          target.bindingId === null
            ? resource.removedBindingIds
            : [...resource.removedBindingIds, target.bindingId],
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// 交给后端
// ---------------------------------------------------------------------------

const text = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const count = (value: string) => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const time = (value: string) => (value ? new Date(value).toISOString() : null);

const sameFields = (
  left: ResourceFieldsDraft,
  right: ResourceFieldsDraft | null,
) => right !== null && JSON.stringify(left) === JSON.stringify(right);

/** 入参里那几层的形状，从接口类型上摘下来——用于给 flatMap 标注元素类型。 */
type DemandPayload = NonNullable<SaveSegmentConfigValues["demands"]>[number];
type ResourcePayload = NonNullable<DemandPayload["resources"]>[number];
type BindTargetPayload = NonNullable<ResourcePayload["bindTargets"]>[number];

const toApiFields = (fields: ResourceFieldsDraft) => ({
  transportScene: fields.transportScene || null,
  name: fields.name.trim(),
  quantity: count(fields.quantity),
  startTime: time(fields.startTime),
  endTime: time(fields.endTime),
  location: text(fields.location),
  vehicleInfo: text(fields.vehicleInfo),
  driverName: text(fields.driverName),
  driverPhone: text(fields.driverPhone),
  ownerName: text(fields.ownerName),
  remark: text(fields.remark),
});

/**
 * 把草稿翻译成保存入参。
 *
 * `lines` 用来把 lineKey 还原成 agendaLineId："main" 要找出真正的主线 id（没有
 * 主线时传 null，服务端懒创建），"new" 传 null 并带上 newLineName。
 */
export function buildSavePayload(input: {
  draft: ConfigDraft;
  activityId: number;
  segmentId: number | null;
  mainLineId: number | null;
  cascadeSeats: boolean;
}): SaveSegmentConfigValues {
  const { draft, activityId, segmentId, mainLineId, cascadeSeats } = input;
  const { base } = draft;

  const agendaLineId =
    base.lineKey === "new"
      ? null
      : base.lineKey === "main"
        ? mainLineId
        : Number(base.lineKey);

  return {
    activityId,
    segmentId,
    base: {
      name: base.name.trim(),
      segmentType: base.segmentType,
      agendaLineId,
      startTime: new Date(base.startTime).toISOString(),
      endTime: new Date(base.endTime).toISOString(),
      locationText: text(base.locationText) ?? undefined,
      ownerName: text(base.ownerName) ?? undefined,
      description: text(base.description) ?? undefined,
      memberEnabled: base.memberEnabled,
      seatingEnabled: base.seatingEnabled,
    },
    newLineName: base.lineKey === "new" ? base.newLineName.trim() : undefined,
    members: {
      // 从人员库选的：带 memberId。
      // flatMap 而不是 filter().map()：filter 的判定 TS 跟不进 map 里，
      // 写成后者就得靠断言把 null 压掉，而断言在过滤条件被改动时不会报错。
      add: draft.members.flatMap((row) =>
        row.relationId === null && row.memberId !== null
          ? [
              {
                tempKey: row.key,
                memberId: row.memberId,
                segmentRole: row.segmentRole,
              },
            ]
          : [],
      ),
      // 手动录入的：带主档字段，服务端先建人再建三层关系。
      addNew: draft.members.flatMap((row) =>
        row.relationId === null && row.newMember !== null
          ? [
              {
                tempKey: row.key,
                member: {
                  name: row.newMember.name.trim(),
                  gender: row.newMember.gender || undefined,
                  companyPosition:
                    text(row.newMember.companyPosition) ?? undefined,
                  mobile: text(row.newMember.mobile) ?? undefined,
                  idType: row.newMember.idType || undefined,
                  idNumber: text(row.newMember.idNumber) ?? undefined,
                  remark: text(row.newMember.remark) ?? undefined,
                },
                segmentRole: row.segmentRole,
              },
            ]
          : [],
      ),
      remove: draft.removedRelationIds,
      // 只发真的改过的行——发全量等于把没动过的行也重写一遍，
      // 那正是"目标状态"语义的坏处。
      updateRoles: draft.members.flatMap((row) =>
        row.relationId !== null && row.segmentRole !== (row.savedRole ?? "")
          ? [{ relationId: row.relationId, segmentRole: row.segmentRole }]
          : [],
      ),
      cascadeSeats,
    },
    // 需求是矩阵：只发开着的，关掉的类型不出现在数组里就等于删除。
    demands: draft.demands
      .filter((demand) => demand.enabled)
      .map((demand) => ({
        resourceType: demand.resourceType,
        handling: demand.handling,
        description: text(demand.description),
        estimatedCount: count(demand.estimatedCount),
        ownerName: text(demand.ownerName),
        resources: demand.resources.map((resource): ResourcePayload => {
          // 只发本次新绑的（bindingId 为 null）——已保存的绑定不重发，
          // 它们本来就在库里，重发只会多一次 onConflictDoNothing。
          const bindTargets = resource.bindings.flatMap<BindTargetPayload>(
            (binding) => {
              if (binding.bindingId !== null) return [];
              if (binding.activityMemberId !== null) {
                return [{ activityMemberId: binding.activityMemberId }];
              }
              // 草稿里刚加的人还没有活动关系 id，用 tempKey 让服务端回填。
              return binding.memberKey === null
                ? []
                : [{ memberTempKey: binding.memberKey }];
            },
          );

          if (resource.resourceId === null) {
            return {
              kind: "create",
              tempKey: resource.key,
              fields: toApiFields(resource.fields),
              bindTargets,
            };
          }

          return {
            kind: "existing",
            resourceId: resource.resourceId,
            // 没改过就不发字段——少一次不必要的 UPDATE，也少一次和别人并发
            // 编辑同一条资源时互相覆盖的机会。
            fields: sameFields(resource.fields, resource.savedFields)
              ? null
              : toApiFields(resource.fields),
            bindTargets,
            unbindIds: resource.removedBindingIds,
          };
        }),
        unlinkResourceIds: demand.unlinkResourceIds,
        voidResourceIds: demand.voidResourceIds,
      })),
  };
}

/**
 * 页面是否有未保存的改动。离开拦截和"保存"按钮的可用状态都看它。
 *
 * 直接比较整份草稿的序列化结果，而不是逐字段维护一个 dirty 标记——后者每加
 * 一个字段就多一处可能忘记标记的地方，而那种遗漏的症状是"改了东西直接跳走
 * 没有任何提示"。
 */
export const isDirty = (draft: ConfigDraft, original: ConfigDraft) =>
  JSON.stringify({ ...draft, nextKey: 0 }) !==
  JSON.stringify({ ...original, nextKey: 0 });
