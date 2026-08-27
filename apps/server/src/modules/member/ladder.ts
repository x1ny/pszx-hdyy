import { and, eq, inArray, isNull } from "drizzle-orm";
import type { db } from "../../infra/db";
import { activitySegment } from "../agenda/schema";
import { activity, project } from "../project/schema";
import {
  activityMember,
  type MemberIdType,
  type MemberRelationOrigin,
  member,
  projectMember,
  type SegmentMemberRole,
  segmentMember,
} from "./schema";

/**
 * 人员分层的**唯一写入入口**。
 *
 * BR-DEV-026 要求："项目、活动、环节入口新增或导入人员时，先创建或引用全量
 * 人员主档，再创建当前层级人员关系；环节入口新增、选择、导入人员时，应同步
 * 补齐当前活动人员关系和项目人员关系。"
 *
 * 这条规则横跨三张表、必须原子生效，而且四个入口（后台新增、导入、项目分配、
 * 报名审核通过）都要走。如果让每个 route handler 自己实现，迟早有一个入口漏写
 * 补齐——漏了之后症状是"环节人员列表里有这个人，活动人员列表里没有"，运营会
 * 当成 bug 报上来，但数据已经脏了。
 *
 * 所以规矩是：**routes 里不许出现对三张关系表的 insert**，一律走这里。
 *
 * 全部函数都要求调用方传入事务句柄——补齐链路只有整条成立才有意义，中途失败
 * 留下半条链比什么都不做更糟。
 */

/** `db.transaction` 回调里那个句柄的类型。drizzle 没导出它，从签名反推。 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * ladder 里的业务失败。在事务里 throw 是最省事的回滚方式，routes 层
 * catch 住翻译成 `err({ code: "VALIDATION_ERROR" })`。
 */
export class MemberLadderError extends Error {}

const fail = (message: string): never => {
  throw new MemberLadderError(message);
};

/** 三层共用的关系字段。环节层传 null 表示"继承活动层"，见 schema 注释。 */
export type RelationFields = {
  source?: string | null;
  groupName?: string | null;
  ownerName?: string | null;
  remark?: string | null;
};

export type MemberEntry = RelationFields & { memberId: number };

export type SegmentMemberEntry = MemberEntry & {
  segmentRole?: SegmentMemberRole | null;
};

/** 关系 id 按 memberId 索引。项目层和环节层只需返回这一份。 */
export type RelationIdByMember = Map<number, number>;

/** 主档在本次新增链路开始时的团体。null 是有效快照，不表示缺少映射。 */
export type OrganizationSnapshotByMember = ReadonlyMap<number, number | null>;

/** 活动关系的有效快照；环节层必须从这里继承，不能重新读取人员主档。 */
export type ActivityRelationByMember = Map<
  number,
  { id: number; organizationId: number | null }
>;

export type ActivityMemberSnapshot = {
  id: number;
  activityId: number;
  memberId: number;
  organizationId: number | null;
};

const dedupe = (entries: readonly MemberEntry[]) => {
  // 选择抽屉多选 + 已选列表可能送来重复的 memberId，先收敛掉。留第一条，
  // 因为批量插入时后面那条本来也会被唯一键挡掉，行为一致。
  const seen = new Map<number, MemberEntry>();
  for (const entry of entries) {
    if (!seen.has(entry.memberId)) seen.set(entry.memberId, entry);
  }
  return [...seen.values()];
};

/**
 * 主档必须存在且启用。
 *
 * 规则 7："全量人员主档禁用后不删除历史关系和历史展示，只禁止继续新增项目、
 * 活动、环节、邀请函、排位、资源服务等新关系。"——禁用挡的是**新增**，不是
 * 已有关系，所以这个检查只在 ensure 路径上，不在读取路径上。
 */
async function assertMembersUsable(
  tx: Tx,
  memberIds: readonly number[],
): Promise<OrganizationSnapshotByMember> {
  const rows = await tx
    .select({
      id: member.id,
      name: member.name,
      status: member.status,
      organizationId: member.organizationId,
    })
    .from(member)
    .where(inArray(member.id, [...memberIds]));

  if (rows.length !== memberIds.length) {
    fail("选中的人员中有已不存在的记录，请刷新后重试");
  }

  const disabled = rows.filter((row) => row.status === "disabled");
  if (disabled.length > 0) {
    const names = disabled.map((row) => row.name).join("、");
    fail(`${names} 已禁用，不能新增参与关系`);
  }

  return new Map(rows.map((row) => [row.id, row.organizationId]));
}

const organizationSnapshotOf = (
  snapshots: OrganizationSnapshotByMember,
  memberId: number,
): number | null => {
  // `Map#get()` 无法区分“没有这个人”和“这个人的快照就是 null”，必须先 has。
  if (!snapshots.has(memberId)) fail("人员团体快照读取失败，请刷新后重试");
  return snapshots.get(memberId) ?? null;
};

// ---------------------------------------------------------------------------
// 手动录入：先建主档，再建关系
// ---------------------------------------------------------------------------

/** 关系入口手动录入时能填的主档字段。完整维护在全量人员库，这里只收常用几项。 */
export type NewMemberFields = {
  name: string;
  gender?: "男" | "女" | null;
  companyPosition?: string | null;
  idType?: MemberIdType | null;
  idNumber?: string | null;
  mobile?: string | null;
  remark?: string | null;
};

/**
 * 在事务里新建主档，返回 memberId。
 *
 * 三个关系层的"手动录入"都走这里，保证 BR-DEV-026 的第一句——"先创建或引用
 * 全量人员主档，再创建当前层级关系"——在三个入口是同一份实现。人建出来了但
 * 关系没建成的话整个事务回滚，不会在全量库里留一条谁也不知道哪来的孤儿主档。
 *
 * 证件查重在这里做而不是靠数据库那条 partial unique index 兜：索引撞上会抛
 * 23503 之外的 23505，翻译成人话要额外一层解析，不如查一次直接说清楚。
 * 索引仍然是最后一道保险（并发下两个请求同时录同一个证件号）。
 */
export async function createMemberInTx(
  tx: Tx,
  fields: NewMemberFields,
  userId: string,
): Promise<number> {
  if (fields.idType && fields.idNumber) {
    const [dup] = await tx
      .select({ id: member.id, name: member.name })
      .from(member)
      .where(
        and(
          eq(member.idType, fields.idType),
          eq(member.idNumber, fields.idNumber),
        ),
      )
      .limit(1);

    if (dup) {
      fail(
        `该证件号码已属于全量人员库中的「${dup.name}」，请改用"从已有人员选择"`,
      );
    }
  }

  const [row] = await tx
    .insert(member)
    .values({
      name: fields.name,
      gender: fields.gender ?? null,
      companyPosition: fields.companyPosition ?? null,
      idType: fields.idType ?? null,
      idNumber: fields.idNumber ?? null,
      mobile: fields.mobile ?? null,
      remark: fields.remark ?? null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: member.id });

  return row?.id ?? fail("人员创建失败，请重试");
}

// ---------------------------------------------------------------------------
// 项目层
// ---------------------------------------------------------------------------

/**
 * 把人拉进项目范围。已有关系时**不覆盖**它的 sourceType 和 organizationId——
 * 一个运营手工加进项目的人，不该因为后来从某个环节补齐过一次就被改写来源；
 * 人员主档后来换了团体，也不能倒灌改写这条历史快照。
 */
export async function ensureProjectMembers(
  tx: Tx,
  input: {
    projectId: number;
    memberIds: readonly number[];
    sourceType: MemberRelationOrigin;
    userId: string;
    /** 下层入口已经读取过时沿链传播，避免每补一层都重读主档产生漂移。 */
    organizationSnapshots?: OrganizationSnapshotByMember;
  },
): Promise<RelationIdByMember> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return new Map();

  const organizationSnapshots =
    input.organizationSnapshots ?? (await assertMembersUsable(tx, memberIds));

  await tx
    .insert(projectMember)
    .values(
      memberIds.map((memberId) => ({
        projectId: input.projectId,
        memberId,
        organizationId: organizationSnapshotOf(organizationSnapshots, memberId),
        sourceType: input.sourceType,
        createdBy: input.userId,
        updatedBy: input.userId,
      })),
    )
    // 打在 uk_project_member 上。冲突即"这个人已经在项目里了"，正是 ensure
    // 想要的语义，也顺带消掉了并发下两个请求同时拉同一个人的竞态。
    .onConflictDoNothing({
      target: [projectMember.projectId, projectMember.memberId],
    });

  // 插入用 onConflictDoNothing 就拿不回冲突行的 id，所以统一再查一次。
  // 两次往返换来的是批量大小无关的固定开销——1 个人和 1000 个人一样是 2 跳。
  const rows = await tx
    .select({ id: projectMember.id, memberId: projectMember.memberId })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, input.projectId),
        inArray(projectMember.memberId, memberIds),
      ),
    );

  return new Map(rows.map((row) => [row.memberId, row.id]));
}

// ---------------------------------------------------------------------------
// 活动层
// ---------------------------------------------------------------------------

export async function ensureActivityMembers(
  tx: Tx,
  input: {
    activityId: number;
    entries: readonly MemberEntry[];
    originType: MemberRelationOrigin;
    userId: string;
    /** ensureSegmentMembers 传入同一次主档读取，保证自动补齐的上层拿同一快照。 */
    organizationSnapshots?: OrganizationSnapshotByMember;
    /**
     * 补齐项目关系时记的录入渠道。默认 backfill_from_activity，只有
     * ensureSegmentMembers 会覆盖成 backfill_from_segment——链条从环节起头时，
     * 项目关系也该记成"环节带进来的"，而不是"活动带进来的"。文档 8.1.2 规则 6
     * 只写了活动层要记"环节导入"，但同一句话的道理对项目层一样成立：运营在
     * 项目人员页看到 backfill_from_activity 会去活动人员页找这条关系的来头，
     * 而它其实是从某个环节冒出来的。
     */
    projectSourceType?: MemberRelationOrigin;
  },
): Promise<ActivityRelationByMember> {
  const entries = dedupe(input.entries);
  if (entries.length === 0) return new Map();

  const memberIds = entries.map((entry) => entry.memberId);
  const organizationSnapshots =
    input.organizationSnapshots ?? (await assertMembersUsable(tx, memberIds));

  const [row] = await tx
    .select({ projectId: activity.projectId })
    .from(activity)
    .where(eq(activity.id, input.activityId));
  if (!row) fail("活动不存在");
  const projectId = row.projectId;

  // ⭐ 补齐上一层。项目关系记的是 backfill_* 而不是原样透传 originType：
  // 运营在项目人员页看到的应该是"这条是从下面带上来的"，而不是"这条是导入的"
  // ——后者会让人以为项目层自己做过一次导入。
  const projectMemberIds = await ensureProjectMembers(tx, {
    projectId,
    memberIds,
    sourceType: input.projectSourceType ?? "backfill_from_activity",
    userId: input.userId,
    organizationSnapshots,
  });

  /**
   * 冲突规则：唯一键已存在时完整保留旧活动关系（包括 organizationId），绝不
   * 用本次从主档读到的新值覆盖。活动关系是独立快照，因此项目关系已经存在且
   * 快照不同也不构成错误；只有本次自动补建的项目关系才会拿到同一个新快照。
   */
  await tx
    .insert(activityMember)
    .values(
      entries.map((entry) => ({
        activityId: input.activityId,
        projectId,
        projectMemberId:
          projectMemberIds.get(entry.memberId) ??
          fail("项目人员关系补齐失败，请重试"),
        memberId: entry.memberId,
        organizationId: organizationSnapshotOf(
          organizationSnapshots,
          entry.memberId,
        ),
        source: entry.source ?? null,
        groupName: entry.groupName ?? null,
        ownerName: entry.ownerName ?? null,
        remark: entry.remark ?? null,
        originType: input.originType,
        createdBy: input.userId,
        updatedBy: input.userId,
      })),
    )
    .onConflictDoNothing({
      target: [activityMember.activityId, activityMember.memberId],
    });

  const rows = await tx
    .select({
      id: activityMember.id,
      memberId: activityMember.memberId,
      organizationId: activityMember.organizationId,
    })
    .from(activityMember)
    .where(
      and(
        eq(activityMember.activityId, input.activityId),
        inArray(activityMember.memberId, memberIds),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.memberId,
      { id: row.id, organizationId: row.organizationId },
    ]),
  );
}

// ---------------------------------------------------------------------------
// 环节层
// ---------------------------------------------------------------------------

/**
 * 从一条已经校验过归属的活动关系补建环节关系。
 *
 * 排位模块保留了一个旧客户端兼容入口，它允许在环节人员开关关闭时补关系，不能
 * 直接复用 ensureSegmentMembers 的业务校验；但实际 insert 仍必须回到 ladder，
 * 并且只能继承调用方刚查出的活动快照。唯一键冲突时完整保留已有环节关系。
 */
export async function ensureSegmentMemberFromActivity(
  tx: Tx,
  input: {
    segmentId: number;
    activityMember: ActivityMemberSnapshot;
    originType: MemberRelationOrigin;
    userId: string;
  },
): Promise<number> {
  const relation = input.activityMember;

  await tx
    .insert(segmentMember)
    .values({
      segmentId: input.segmentId,
      activityId: relation.activityId,
      activityMemberId: relation.id,
      memberId: relation.memberId,
      organizationId: relation.organizationId,
      originType: input.originType,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .onConflictDoNothing({
      target: [segmentMember.segmentId, segmentMember.activityMemberId],
    });

  const [row] = await tx
    .select({ id: segmentMember.id })
    .from(segmentMember)
    .where(
      and(
        eq(segmentMember.segmentId, input.segmentId),
        eq(segmentMember.activityMemberId, relation.id),
      ),
    );

  return row?.id ?? fail("补建环节人员失败，请重试");
}

/**
 * 环节人员。这是补齐链路最长的一条：环节 → 活动 → 项目 → 主档，四层一个事务。
 *
 * 文档 8.1.2 规则 6："环节人员导入的环节身份、来源、分组、负责人、备注为环节
 * 关系字段；若需同步生成活动人员关系，活动关系默认使用同一来源、分组、负责人
 * 并记录数据来源为'环节导入'。"——所以补出来的活动关系要把这三个值**带过去**，
 * 而不是留空。带过去之后环节层这三列存的还是原值，看着冗余，但那是
 * "显式覆盖"和"继承"在数据上可区分的代价，见 schema 里的说明。
 */
export async function ensureSegmentMembers(
  tx: Tx,
  input: {
    segmentId: number;
    entries: readonly SegmentMemberEntry[];
    originType: MemberRelationOrigin;
    userId: string;
  },
): Promise<RelationIdByMember> {
  const entries = dedupe(input.entries) as SegmentMemberEntry[];
  if (entries.length === 0) return new Map();

  const memberIds = entries.map((entry) => entry.memberId);
  const organizationSnapshots = await assertMembersUsable(tx, memberIds);

  const [row] = await tx
    .select({
      activityId: activitySegment.activityId,
      status: activitySegment.status,
      memberEnabled: activitySegment.memberEnabled,
    })
    .from(activitySegment)
    .where(eq(activitySegment.id, input.segmentId));
  if (!row) fail("环节不存在");

  // 作废环节不再进入新的业务（BR-DEV 8.2.1 规则 5）。
  if (row.status === "voided") fail("该环节已作废，不能再维护环节人员");
  // 环节人员管理是环节配置里的显式开关，关着的时候不该有人员数据流进来。
  if (!row.memberEnabled) fail("该环节未开启环节人员管理");

  const activityId = row.activityId;

  const activityMemberIds = await ensureActivityMembers(tx, {
    activityId,
    entries,
    originType: "backfill_from_segment",
    projectSourceType: "backfill_from_segment",
    userId: input.userId,
    organizationSnapshots,
  });

  await tx
    .insert(segmentMember)
    .values(
      entries.map((entry) => {
        const activityRelation =
          activityMemberIds.get(entry.memberId) ??
          fail("活动人员关系补齐失败，请重试");

        return {
          segmentId: input.segmentId,
          activityId,
          activityMemberId: activityRelation.id,
          memberId: entry.memberId,
          // 环节默认继承**实际存在的活动关系**。若活动关系是旧数据（包括 null）
          // 或快照与当前主档不同，保留历史活动快照，不能借补环节之机偷偷刷新。
          organizationId: activityRelation.organizationId,
          segmentRole: entry.segmentRole ?? null,
          source: entry.source ?? null,
          groupName: entry.groupName ?? null,
          ownerName: entry.ownerName ?? null,
          remark: entry.remark ?? null,
          originType: input.originType,
          createdBy: input.userId,
          updatedBy: input.userId,
        };
      }),
    )
    .onConflictDoNothing({
      target: [segmentMember.segmentId, segmentMember.activityMemberId],
    });

  const rows = await tx
    .select({ id: segmentMember.id, memberId: segmentMember.memberId })
    .from(segmentMember)
    .where(
      and(
        eq(segmentMember.segmentId, input.segmentId),
        inArray(segmentMember.memberId, memberIds),
      ),
    );

  return new Map(rows.map((r) => [r.memberId, r.id]));
}

// ---------------------------------------------------------------------------
// 按团体批量添加
// ---------------------------------------------------------------------------

export type OrganizationBatchLayer = "project" | "activity" | "segment";

export type OrganizationBatchConflict = {
  layer: OrganizationBatchLayer;
  relationId: number;
  existingOrganizationId: number;
};

export type OrganizationBatchItem = {
  memberId: number;
  name: string;
  outcome: "added" | "existing" | "skipped";
  /** 旧关系本来是 null、本次明确按团体添加后补记的层级。 */
  filledLayers: OrganizationBatchLayer[];
  /** 任一层冲突都会让这个人员的整条 ladder 跳过，绝不只补其中一半。 */
  conflicts: OrganizationBatchConflict[];
};

export type OrganizationBatchResult = {
  organizationId: number;
  targetLayer: OrganizationBatchLayer;
  /** 目标层新建关系的人数。 */
  added: number;
  /** 目标层已有关系的人数；目标层 null 快照补记后仍算 existing。 */
  existing: number;
  /** 所有层级发现的异团体关系条数，一个人可能贡献多条。 */
  conflict: number;
  /** 因至少一层冲突而整条 ladder 未写入的人数。 */
  skipped: number;
  items: OrganizationBatchItem[];
};

type OrganizationBatchMember = { id: number; name: string };
type OrganizationBatchRelation = {
  id: number;
  memberId: number;
  organizationId: number | null;
};

type OrganizationBatchPlan = {
  result: OrganizationBatchResult;
  eligibleMemberIds: number[];
};

const layersThrough = (
  targetLayer: OrganizationBatchLayer,
): OrganizationBatchLayer[] => {
  if (targetLayer === "project") return ["project"];
  if (targetLayer === "activity") return ["project", "activity"];
  return ["project", "activity", "segment"];
};

/**
 * 纯预检：同团体去重、null 标为待补记、异团体标为冲突。
 *
 * 四个计数的口径刻意不是猜出来的数据库 affectedRows：
 * `added + existing + skipped = members.length`；`conflict` 是关系冲突条数，
 * 因此一个人在项目和活动两层都冲突时会是 skipped 1、conflict 2。
 */
export function planOrganizationBatch(input: {
  organizationId: number;
  targetLayer: OrganizationBatchLayer;
  members: readonly OrganizationBatchMember[];
  relations: Partial<
    Record<OrganizationBatchLayer, readonly OrganizationBatchRelation[]>
  >;
}): OrganizationBatchPlan {
  const layers = layersThrough(input.targetLayer);
  const byLayer = new Map<
    OrganizationBatchLayer,
    Map<number, OrganizationBatchRelation>
  >();

  for (const layer of layers) {
    byLayer.set(
      layer,
      new Map(
        (input.relations[layer] ?? []).map((relation) => [
          relation.memberId,
          relation,
        ]),
      ),
    );
  }

  const items: OrganizationBatchItem[] = input.members.map((memberRow) => {
    const conflicts: OrganizationBatchConflict[] = [];
    const filledLayers: OrganizationBatchLayer[] = [];

    for (const layer of layers) {
      const relation = byLayer.get(layer)?.get(memberRow.id);
      if (!relation) continue;
      if (relation.organizationId === null) {
        filledLayers.push(layer);
      } else if (relation.organizationId !== input.organizationId) {
        conflicts.push({
          layer,
          relationId: relation.id,
          existingOrganizationId: relation.organizationId,
        });
      }
    }

    if (conflicts.length > 0) {
      return {
        memberId: memberRow.id,
        name: memberRow.name,
        outcome: "skipped" as const,
        // 该人员完全不写；即使另一个层级是 null，也不应误导调用方以为补记了。
        filledLayers: [],
        conflicts,
      };
    }

    const targetExists = byLayer.get(input.targetLayer)?.has(memberRow.id);
    return {
      memberId: memberRow.id,
      name: memberRow.name,
      outcome: targetExists ? ("existing" as const) : ("added" as const),
      filledLayers,
      conflicts,
    };
  });

  return {
    result: {
      organizationId: input.organizationId,
      targetLayer: input.targetLayer,
      added: items.filter((item) => item.outcome === "added").length,
      existing: items.filter((item) => item.outcome === "existing").length,
      conflict: items.reduce((total, item) => total + item.conflicts.length, 0),
      skipped: items.filter((item) => item.outcome === "skipped").length,
      items,
    },
    eligibleMemberIds: items
      .filter((item) => item.outcome !== "skipped")
      .map((item) => item.memberId),
  };
}

/**
 * 提交时重新读取并锁住人员主档。
 *
 * 候选接口只是 UI 数据源，不能替代写入时校验。这里按 id 排序加行锁，既防止
 * 校验后到提交前主档换团体，也让两批重叠人员以稳定顺序拿锁，减少死锁风险。
 */
async function lockOrganizationMembers(
  tx: Tx,
  organizationId: number,
  memberIds: readonly number[],
): Promise<OrganizationBatchMember[]> {
  const uniqueIds = [...new Set(memberIds)];
  const rows = await tx
    .select({
      id: member.id,
      name: member.name,
      status: member.status,
      organizationId: member.organizationId,
    })
    .from(member)
    .where(inArray(member.id, uniqueIds))
    .orderBy(member.id)
    .for("update");

  const byId = new Map(rows.map((row) => [row.id, row]));
  const missingIds = uniqueIds.filter((memberId) => !byId.has(memberId));
  if (missingIds.length > 0) {
    fail(
      `人员 ${missingIds.map((id) => `#${id}`).join("、")} 不存在，请刷新后重试`,
    );
  }

  const disabled = rows.filter((row) => row.status === "disabled");
  if (disabled.length > 0) {
    fail(`${disabled.map((row) => row.name).join("、")} 已禁用，整批未添加`);
  }

  const moved = rows.filter((row) => row.organizationId !== organizationId);
  if (moved.length > 0) {
    fail(
      `${moved.map((row) => row.name).join("、")} 提交时已不属于所选团体，整批未添加`,
    );
  }

  // 数据库为了锁顺序按 id 返回；响应明细仍按客户端最终勾选顺序，方便逐行对照。
  return uniqueIds.map((memberId) => {
    const row = byId.get(memberId) ?? fail("人员主档读取失败，请刷新后重试");
    return { id: row.id, name: row.name };
  });
}

async function assertProjectExists(tx: Tx, projectId: number) {
  const [row] = await tx
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) fail("项目不存在");
}

async function getActivityScope(tx: Tx, activityId: number) {
  const [row] = await tx
    .select({ id: activity.id, projectId: activity.projectId })
    .from(activity)
    .where(eq(activity.id, activityId))
    .limit(1);
  if (!row) fail("活动不存在");
  return row;
}

async function getSegmentScope(tx: Tx, segmentId: number) {
  const [segment] = await tx
    .select({
      id: activitySegment.id,
      activityId: activitySegment.activityId,
      status: activitySegment.status,
      memberEnabled: activitySegment.memberEnabled,
    })
    .from(activitySegment)
    .where(eq(activitySegment.id, segmentId))
    .limit(1);
  if (!segment) fail("环节不存在");
  if (segment.status === "voided") fail("该环节已作废，整批未添加");
  if (!segment.memberEnabled) fail("该环节未开启环节人员管理，整批未添加");

  const activityScope = await getActivityScope(tx, segment.activityId);
  return { activityId: segment.activityId, projectId: activityScope.projectId };
}

const loadProjectOrganizationRelations = (
  tx: Tx,
  projectId: number,
  memberIds: readonly number[],
) =>
  tx
    .select({
      id: projectMember.id,
      memberId: projectMember.memberId,
      organizationId: projectMember.organizationId,
    })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, projectId),
        inArray(projectMember.memberId, [...memberIds]),
      ),
    )
    .for("update");

const loadActivityOrganizationRelations = (
  tx: Tx,
  activityId: number,
  memberIds: readonly number[],
) =>
  tx
    .select({
      id: activityMember.id,
      memberId: activityMember.memberId,
      organizationId: activityMember.organizationId,
    })
    .from(activityMember)
    .where(
      and(
        eq(activityMember.activityId, activityId),
        inArray(activityMember.memberId, [...memberIds]),
      ),
    )
    .for("update");

const loadSegmentOrganizationRelations = (
  tx: Tx,
  segmentId: number,
  memberIds: readonly number[],
) =>
  tx
    .select({
      id: segmentMember.id,
      memberId: segmentMember.memberId,
      organizationId: segmentMember.organizationId,
    })
    .from(segmentMember)
    .where(
      and(
        eq(segmentMember.segmentId, segmentId),
        inArray(segmentMember.memberId, [...memberIds]),
      ),
    )
    .for("update");

const assertFinalOrganizationRelations = (
  rows: readonly OrganizationBatchRelation[],
  memberIds: readonly number[],
  organizationId: number,
  label: string,
) => {
  const byMember = new Map(rows.map((row) => [row.memberId, row]));
  for (const memberId of memberIds) {
    const row = byMember.get(memberId) ?? fail(`${label}关系补齐失败，请重试`);
    if (row.organizationId !== organizationId) {
      // 预检后若有并发请求抢先写入异团体快照，抛错让本事务整批回滚；已有值
      // 仍不覆盖。正常的静态冲突已在 planOrganizationBatch 中作为明细返回。
      fail(`${label}团体快照发生并发冲突，整批未添加`);
    }
  }
};

async function writeProjectOrganizationLayer(
  tx: Tx,
  input: {
    projectId: number;
    memberIds: readonly number[];
    organizationId: number;
    sourceType: MemberRelationOrigin;
    userId: string;
  },
): Promise<RelationIdByMember> {
  if (input.memberIds.length === 0) return new Map();

  await tx
    .update(projectMember)
    .set({ organizationId: input.organizationId, updatedBy: input.userId })
    .where(
      and(
        eq(projectMember.projectId, input.projectId),
        inArray(projectMember.memberId, [...input.memberIds]),
        isNull(projectMember.organizationId),
      ),
    );

  await tx
    .insert(projectMember)
    .values(
      input.memberIds.map((memberId) => ({
        projectId: input.projectId,
        memberId,
        organizationId: input.organizationId,
        sourceType: input.sourceType,
        createdBy: input.userId,
        updatedBy: input.userId,
      })),
    )
    .onConflictDoNothing({
      target: [projectMember.projectId, projectMember.memberId],
    });

  const rows = await loadProjectOrganizationRelations(
    tx,
    input.projectId,
    input.memberIds,
  );
  assertFinalOrganizationRelations(
    rows,
    input.memberIds,
    input.organizationId,
    "项目人员",
  );
  return new Map(rows.map((row) => [row.memberId, row.id]));
}

async function writeActivityOrganizationLayer(
  tx: Tx,
  input: {
    activityId: number;
    projectId: number;
    memberIds: readonly number[];
    projectMemberIds: RelationIdByMember;
    organizationId: number;
    originType: MemberRelationOrigin;
    userId: string;
  },
): Promise<ActivityRelationByMember> {
  if (input.memberIds.length === 0) return new Map();

  await tx
    .update(activityMember)
    .set({ organizationId: input.organizationId, updatedBy: input.userId })
    .where(
      and(
        eq(activityMember.activityId, input.activityId),
        inArray(activityMember.memberId, [...input.memberIds]),
        isNull(activityMember.organizationId),
      ),
    );

  await tx
    .insert(activityMember)
    .values(
      input.memberIds.map((memberId) => ({
        activityId: input.activityId,
        projectId: input.projectId,
        projectMemberId:
          input.projectMemberIds.get(memberId) ??
          fail("项目人员关系补齐失败，请重试"),
        memberId,
        organizationId: input.organizationId,
        originType: input.originType,
        createdBy: input.userId,
        updatedBy: input.userId,
      })),
    )
    .onConflictDoNothing({
      target: [activityMember.activityId, activityMember.memberId],
    });

  const rows = await loadActivityOrganizationRelations(
    tx,
    input.activityId,
    input.memberIds,
  );
  assertFinalOrganizationRelations(
    rows,
    input.memberIds,
    input.organizationId,
    "活动人员",
  );
  return new Map(
    rows.map((row) => [
      row.memberId,
      { id: row.id, organizationId: row.organizationId },
    ]),
  );
}

async function writeSegmentOrganizationLayer(
  tx: Tx,
  input: {
    segmentId: number;
    activityId: number;
    memberIds: readonly number[];
    activityMemberIds: ActivityRelationByMember;
    organizationId: number;
    originType: MemberRelationOrigin;
    userId: string;
  },
): Promise<RelationIdByMember> {
  if (input.memberIds.length === 0) return new Map();

  await tx
    .update(segmentMember)
    .set({ organizationId: input.organizationId, updatedBy: input.userId })
    .where(
      and(
        eq(segmentMember.segmentId, input.segmentId),
        inArray(segmentMember.memberId, [...input.memberIds]),
        isNull(segmentMember.organizationId),
      ),
    );

  await tx
    .insert(segmentMember)
    .values(
      input.memberIds.map((memberId) => ({
        segmentId: input.segmentId,
        activityId: input.activityId,
        activityMemberId:
          input.activityMemberIds.get(memberId)?.id ??
          fail("活动人员关系补齐失败，请重试"),
        memberId,
        organizationId: input.organizationId,
        originType: input.originType,
        createdBy: input.userId,
        updatedBy: input.userId,
      })),
    )
    .onConflictDoNothing({
      target: [segmentMember.segmentId, segmentMember.activityMemberId],
    });

  const rows = await loadSegmentOrganizationRelations(
    tx,
    input.segmentId,
    input.memberIds,
  );
  assertFinalOrganizationRelations(
    rows,
    input.memberIds,
    input.organizationId,
    "环节人员",
  );
  return new Map(rows.map((row) => [row.memberId, row.id]));
}

/**
 * 按团体添加项目人员。成员硬校验失败时抛错让外层事务整批回滚；历史异团体
 * 快照则作为 conflict + skipped 返回，绝不覆盖。
 */
export async function addProjectMembersByOrganization(
  tx: Tx,
  input: {
    projectId: number;
    organizationId: number;
    memberIds: readonly number[];
    userId: string;
  },
): Promise<OrganizationBatchResult> {
  await assertProjectExists(tx, input.projectId);
  const members = await lockOrganizationMembers(
    tx,
    input.organizationId,
    input.memberIds,
  );
  const projectRelations = await loadProjectOrganizationRelations(
    tx,
    input.projectId,
    input.memberIds,
  );
  const plan = planOrganizationBatch({
    organizationId: input.organizationId,
    targetLayer: "project",
    members,
    relations: { project: projectRelations },
  });

  await writeProjectOrganizationLayer(tx, {
    projectId: input.projectId,
    memberIds: plan.eligibleMemberIds,
    organizationId: input.organizationId,
    sourceType: "import",
    userId: input.userId,
  });
  return plan.result;
}

/**
 * 按团体添加活动人员。项目层异团体也视为该人员冲突，避免只补活动、不补项目；
 * 非冲突人员的 null 快照与缺失关系在同一事务中补齐。
 */
export async function addActivityMembersByOrganization(
  tx: Tx,
  input: {
    activityId: number;
    organizationId: number;
    memberIds: readonly number[];
    userId: string;
  },
): Promise<OrganizationBatchResult> {
  const scope = await getActivityScope(tx, input.activityId);
  const members = await lockOrganizationMembers(
    tx,
    input.organizationId,
    input.memberIds,
  );
  const projectRelations = await loadProjectOrganizationRelations(
    tx,
    scope.projectId,
    input.memberIds,
  );
  const activityRelations = await loadActivityOrganizationRelations(
    tx,
    input.activityId,
    input.memberIds,
  );
  const plan = planOrganizationBatch({
    organizationId: input.organizationId,
    targetLayer: "activity",
    members,
    relations: { project: projectRelations, activity: activityRelations },
  });

  const projectMemberIds = await writeProjectOrganizationLayer(tx, {
    projectId: scope.projectId,
    memberIds: plan.eligibleMemberIds,
    organizationId: input.organizationId,
    sourceType: "backfill_from_activity",
    userId: input.userId,
  });
  await writeActivityOrganizationLayer(tx, {
    activityId: input.activityId,
    projectId: scope.projectId,
    memberIds: plan.eligibleMemberIds,
    projectMemberIds,
    organizationId: input.organizationId,
    originType: "import",
    userId: input.userId,
  });
  return plan.result;
}

/**
 * 按团体添加环节人员。环节必须正常且开启人员管理；项目/活动/环节任一旧关系
 * 快照冲突都会跳过该人员整条链，其他人员一次性补齐三层。
 */
export async function addSegmentMembersByOrganization(
  tx: Tx,
  input: {
    segmentId: number;
    organizationId: number;
    memberIds: readonly number[];
    userId: string;
  },
): Promise<OrganizationBatchResult> {
  const scope = await getSegmentScope(tx, input.segmentId);
  const members = await lockOrganizationMembers(
    tx,
    input.organizationId,
    input.memberIds,
  );
  const projectRelations = await loadProjectOrganizationRelations(
    tx,
    scope.projectId,
    input.memberIds,
  );
  const activityRelations = await loadActivityOrganizationRelations(
    tx,
    scope.activityId,
    input.memberIds,
  );
  const segmentRelations = await loadSegmentOrganizationRelations(
    tx,
    input.segmentId,
    input.memberIds,
  );
  const plan = planOrganizationBatch({
    organizationId: input.organizationId,
    targetLayer: "segment",
    members,
    relations: {
      project: projectRelations,
      activity: activityRelations,
      segment: segmentRelations,
    },
  });

  const projectMemberIds = await writeProjectOrganizationLayer(tx, {
    projectId: scope.projectId,
    memberIds: plan.eligibleMemberIds,
    organizationId: input.organizationId,
    sourceType: "backfill_from_segment",
    userId: input.userId,
  });
  const activityMemberIds = await writeActivityOrganizationLayer(tx, {
    activityId: scope.activityId,
    projectId: scope.projectId,
    memberIds: plan.eligibleMemberIds,
    projectMemberIds,
    organizationId: input.organizationId,
    originType: "backfill_from_segment",
    userId: input.userId,
  });
  await writeSegmentOrganizationLayer(tx, {
    segmentId: input.segmentId,
    activityId: scope.activityId,
    memberIds: plan.eligibleMemberIds,
    activityMemberIds,
    organizationId: input.organizationId,
    originType: "import",
    userId: input.userId,
  });
  return plan.result;
}
