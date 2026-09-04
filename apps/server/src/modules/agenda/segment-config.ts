import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import {
  createMemberInTx,
  ensureSegmentMembers,
  MemberLadderError,
} from "../member/ladder";
import { segmentMember } from "../member/schema";
import {
  bindResourceMembers,
  checkDemandsLinkable,
  ensureDemandLink,
  removeDemandLink,
  replaceSegmentDemands,
  unbindResourceMembers,
} from "../resource/demands";
import {
  activityResource,
  RESOURCE_TYPE_LABELS,
  type ResourceType,
} from "../resource/schema";
import {
  listOrganizationSeatsLeavingScope,
  listSeatsBySegmentMembers,
  releaseOrganizationSeatsLeavingScope,
  releaseSeatsBySegmentMembers,
} from "../seating/cascade";
import { activitySegment, agendaLine } from "./schema";
import {
  findOverlap,
  lockLine,
  overlapMessage,
  recordRevision,
  type SegmentRow,
  segmentFields,
  type Tx,
} from "./segment-write";
import type { SaveSegmentConfigInput } from "./validation";

/**
 * 环节配置页（单页四块、整页原子保存）的写入编排。
 *
 * 这是仓库里最长的一条写路径——一次提交要按顺序碰 8 张表。之所以敢这么写，
 * 是因为**没有一条业务规则在这个文件里重新实现**：人员三层补齐走
 * member/ladder.ts，需求项和资源的规则走 resource/demands.ts，环节自身的
 * 议程线和时间重叠走 segment-write.ts（routes.ts 的单接口也用它们）。
 * 这个文件只负责**顺序**和 **tempKey 的解析**。
 *
 * 两条不能动的顺序约束，写错了都不会报错、只会得到奇怪的结果：
 *
 * 1. **环节必须先写，人员才能加。** `ensureSegmentMembers` 会在事务里重新读
 *    `memberEnabled` 并在关着时拒绝（ladder.ts:466）。同一次保存里"勾上开关 +
 *    加人"是最普通的操作，顺序反了就会被自己这道闸门拦住，用户看到的是"明明
 *    勾了开关还说未开启"。
 * 2. **需求项必须先整体替换，资源安排才能挂。** 资源是挂到需求项 id 上的，
 *    而需求项这一步可能刚被 upsert 出来（新建环节时它们全是新的）。
 *
 * ⚠️ 整个文件都是「环节配置页」这一个功能的，**删掉它不影响任何旧接口**。
 */

// ---------------------------------------------------------------------------
// 聚合保存
// ---------------------------------------------------------------------------

type SaveInput = z.infer<typeof SaveSegmentConfigInput>;

/**
 * 编排结果。`path` 是给前端定位用的——四块合一之后，一句干巴巴的"保存失败"
 * 没法用，页面要能滚到出错的那一块。
 */
export type SaveSegmentConfigResult =
  | { kind: "ok"; segmentId: number }
  | { kind: "notFound"; message: string }
  | { kind: "invalid"; message: string; path?: string }
  /**
   * 保存本身没问题，但会连带解除排位——需要用户确认后带 `cascadeSeats: true`
   * 重来一次。和 invalid 分开是因为前端的处理完全不同：一个是弹确认框、确认
   * 后重发，一个是滚到出错的字段让人改。
   */
  | { kind: "needsConfirm"; message: string };

const invalid = (message: string, path?: string): SaveSegmentConfigResult => ({
  kind: "invalid",
  message,
  path,
});

/**
 * 用异常把失败的编排结果带出事务。
 *
 * `applySegmentConfig` 用**返回值**表达业务失败（比抛异常好读，也强制调用方
 * 处理每一种）。但 drizzle 的 `tx` 回调正常返回就等于提交——这一步之前可能
 * 已经建了人、建了车，照常提交就留下一堆没人引用的孤儿数据。所以路由层收到
 * 非 ok 的结果时把它包成异常抛出去触发回滚，在外面再拆开。
 */
export class SegmentConfigAbort extends Error {
  constructor(readonly result: SaveSegmentConfigResult) {
    super("segment config aborted");
  }
}

/**
 * 用车专属的四列在非用车记录上必须为空（表上有 `chk_resource_transport_only`）。
 *
 * 这里不是"顺手清理"，是必须的：资源类型跟着需求走，用户可能先在用车需求下
 * 填了车牌，又把这条安排挪到别处——前端不见得清得干净，让脏值走到数据库就是
 * 一个 500。同时补上用车必填场景的校验，和台账页的 refine 口径一致。
 */
export function normalizeResourceFields(
  resourceType: ResourceType,
  fields: NonNullable<
    Extract<
      SaveInput["demands"][number]["resources"][number],
      { kind: "create" }
    >["fields"]
  >,
  path: string,
):
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; message: string } {
  if (resourceType === "transport" && !fields.transportScene) {
    return { ok: false, message: `${path}：请选择用车场景` };
  }
  if (fields.startTime && fields.endTime && fields.startTime > fields.endTime) {
    return { ok: false, message: `${path}：结束时间不能早于开始时间` };
  }

  const isTransport = resourceType === "transport";
  return {
    ok: true,
    values: {
      resourceType,
      transportScene: isTransport ? fields.transportScene : null,
      name: fields.name,
      quantity: fields.quantity,
      startTime: fields.startTime,
      endTime: fields.endTime,
      location: fields.location,
      vehicleInfo: isTransport ? fields.vehicleInfo : null,
      driverName: isTransport ? fields.driverName : null,
      driverPhone: isTransport ? fields.driverPhone : null,
      ownerName: fields.ownerName,
      remark: fields.remark,
    },
  };
}

/**
 * 整页保存。调用方负责开事务并把 MemberLadderError 翻译成校验错误。
 *
 * 顺序见文件顶部那两条约束。除此之外的顺序是可读性排的，不承载语义。
 */
export async function applySegmentConfig(
  tx: Tx,
  input: SaveInput,
  userId: string,
): Promise<SaveSegmentConfigResult> {
  const { activityId, segmentId, base, newLineName, members, demands } = input;

  // --- 1. 议程线 --------------------------------------------------------
  // 新建并行线和建环节是一次保存动作：不用先关掉页面去别处建线。
  let targetLineId = base.agendaLineId;
  if (newLineName) {
    const [line] = await tx
      .insert(agendaLine)
      .values({
        activityId,
        lineType: "parallel",
        name: newLineName,
        sortOrder: 0,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: agendaLine.id });
    targetLineId = line.id;
  }

  const line = await lockLine(tx, activityId, targetLineId, userId);
  if (!line.ok) return invalid(line.message, "base.agendaLineId");

  // --- 2. 环节本体 ------------------------------------------------------
  // ⚠️ 必须在人员之前：ensureSegmentMembers 会重新读 memberEnabled。
  const { agendaLineId: _ignored, ...baseFields } = base;

  let row: SegmentRow;
  if (segmentId === null) {
    const conflict = await findOverlap(
      tx,
      line.lineId,
      base.startTime,
      base.endTime,
    );
    if (conflict) return invalid(overlapMessage(conflict.name), "base.endTime");

    const [created] = await tx
      .insert(activitySegment)
      .values({
        ...baseFields,
        activityId,
        agendaLineId: line.lineId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning(segmentFields);
    row = created as SegmentRow;
    await recordRevision(tx, row.id as number, "create", row, userId);
  } else {
    const [existing] = await tx
      .select({
        activityId: activitySegment.activityId,
        status: activitySegment.status,
      })
      .from(activitySegment)
      .where(eq(activitySegment.id, segmentId))
      .for("update");

    if (!existing) return { kind: "notFound", message: "环节不存在" };
    if (existing.activityId !== activityId) {
      return invalid("环节不属于当前活动");
    }
    // 作废环节不再进入新的业务（BR-DEV 8.2.1 规则 5）。整页保存会连人员和
    // 资源一起写，对一个作废环节做这些没有意义，整体挡掉而不是逐块挡。
    if (existing.status === "voided") {
      return invalid("环节已作废，请先恢复为正常再配置");
    }

    const conflict = await findOverlap(
      tx,
      line.lineId,
      base.startTime,
      base.endTime,
      segmentId,
    );
    if (conflict) return invalid(overlapMessage(conflict.name), "base.endTime");

    const [updated] = await tx
      .update(activitySegment)
      .set({ ...baseFields, agendaLineId: line.lineId, updatedBy: userId })
      .where(eq(activitySegment.id, segmentId))
      .returning(segmentFields);
    row = updated as SegmentRow;
    await recordRevision(tx, segmentId, "update", row, userId);
  }

  const realSegmentId = row.id as number;

  // --- 3. 环节人员 ------------------------------------------------------
  // 先删后加：同一次保存里"移除张三、加入李四"是两个独立意图，顺序不影响
  // 结果，但先删能让"移除后再以另一种身份加回来"这种操作正常工作。
  if (members.remove.length > 0) {
    // ⚠️ 不能直接 delete：座位分配表通过 segment_member_id 指着这些行，而那条
    // 外键**故意没有 cascade**（见 seating/schema.ts）。直接删要么撞约束报
    // 500，要么在放开约束的将来留下一批指向空气的座位。
    //
    // 移除已排座的人是不可逆的，所以走两段确认——口径和旧的移除弹窗
    // （segmentMember/remove 的 cascade）一致，只是因为这里是草稿，只能等到
    // 保存时才问得出口。
    const removeIds = [...members.remove];
    const [seats, organizationSeats] = await Promise.all([
      listSeatsBySegmentMembers(tx, removeIds),
      listOrganizationSeatsLeavingScope(tx, removeIds),
    ]);

    if (
      (seats.length > 0 || organizationSeats.length > 0) &&
      !members.cascadeSeats
    ) {
      const impacts = [
        seats.length > 0
          ? `个人排位 ${seats.map((seat) => seat.seatLabel).join("、")}`
          : null,
        organizationSeats.length > 0
          ? `团体占位 ${organizationSeats.map((seat) => seat.seatLabel).join("、")}`
          : null,
      ].filter(Boolean);

      return {
        kind: "needsConfirm",
        message: `移除人员后将解除${impacts.join("及")}，确认继续保存？`,
      };
    }

    if (seats.length > 0) {
      await releaseSeatsBySegmentMembers(tx, removeIds, userId);
    }
    if (organizationSeats.length > 0) {
      await releaseOrganizationSeatsLeavingScope(tx, removeIds, userId);
    }

    await tx
      .delete(segmentMember)
      .where(
        and(
          eq(segmentMember.segmentId, realSegmentId),
          inArray(segmentMember.id, removeIds),
        ),
      );
  }

  // tempKey → memberId。手动录入的人先建主档（ladder 保证"先主档后关系"）。
  const memberIdByTempKey = new Map<string, number>();
  for (const entry of members.add) {
    memberIdByTempKey.set(entry.tempKey, entry.memberId);
  }
  for (const entry of members.addNew) {
    const newMemberId = await createMemberInTx(tx, entry.member, userId);
    memberIdByTempKey.set(entry.tempKey, newMemberId);
  }

  const entries = [
    ...members.add.map((entry) => ({
      memberId: entry.memberId,
      segmentRole: entry.segmentRole,
    })),
    ...members.addNew.map((entry) => ({
      memberId:
        memberIdByTempKey.get(entry.tempKey) ??
        // 上面刚 set 过，取不到只可能是 tempKey 重复。
        -1,
      segmentRole: entry.segmentRole,
    })),
  ];

  if (entries.some((entry) => entry.memberId < 0)) {
    return invalid("人员临时标识重复，请刷新后重试", "members");
  }

  if (entries.length > 0) {
    await ensureSegmentMembers(tx, {
      segmentId: realSegmentId,
      entries,
      originType: "manual",
      userId,
    });
  }

  if (members.updateRoles.length > 0) {
    for (const item of members.updateRoles) {
      await tx
        .update(segmentMember)
        .set({ segmentRole: item.segmentRole, updatedBy: userId })
        // segmentId 一起进 where：关系 id 是全局的，不带这个条件就能改到别的
        // 环节的人身上。
        .where(
          and(
            eq(segmentMember.id, item.relationId),
            eq(segmentMember.segmentId, realSegmentId),
          ),
        );
    }
  }

  // tempKey → activityMemberId，供资源绑定使用。ensureSegmentMembers 返回的是
  // 环节关系 id，绑定要的是活动关系 id，所以这里再查一次。
  const activityMemberIdByTempKey = new Map<string, number>();
  if (memberIdByTempKey.size > 0) {
    const memberIds = [...memberIdByTempKey.values()];
    const rows = await tx
      .select({
        memberId: segmentMember.memberId,
        activityMemberId: segmentMember.activityMemberId,
      })
      .from(segmentMember)
      .where(
        and(
          eq(segmentMember.segmentId, realSegmentId),
          inArray(segmentMember.memberId, memberIds),
        ),
      );
    const byMember = new Map(rows.map((r) => [r.memberId, r.activityMemberId]));
    for (const [key, memberId] of memberIdByTempKey) {
      const relationId = byMember.get(memberId);
      if (relationId !== undefined) {
        activityMemberIdByTempKey.set(key, relationId);
      }
    }
  }

  // --- 4. 资源需求（整体替换）-------------------------------------------
  // ⚠️ 必须在资源安排之前：资源挂的是需求项 id，而新建环节时它们全是新的。
  const demandRows = await replaceSegmentDemands(tx, {
    segmentId: realSegmentId,
    activityId,
    demands: demands.map((d) => ({
      resourceType: d.resourceType,
      handling: d.handling,
      description: d.description,
      estimatedCount: d.estimatedCount,
      ownerName: d.ownerName,
    })),
    userId,
  });

  const demandIdByType = new Map(
    demandRows.map((d) => [d.resourceType, d.id] as const),
  );

  // --- 5. 资源安排 ------------------------------------------------------
  for (const demand of demands) {
    const demandId = demandIdByType.get(demand.resourceType);
    if (demandId === undefined) continue;
    // 用中文标签而不是枚举值：这句话会原样出现在运营的 toast 里。
    const label = `${RESOURCE_TYPE_LABELS[demand.resourceType]}资源安排`;

    for (const [index, entry] of demand.resources.entries()) {
      const path = `demands.${demand.resourceType}.resources.${index}`;

      let resourceId: number;

      if (entry.kind === "create") {
        const normalized = normalizeResourceFields(
          demand.resourceType,
          entry.fields,
          `${label}第 ${index + 1} 条`,
        );
        if (!normalized.ok) return invalid(normalized.message, path);

        const [created] = await tx
          .insert(activityResource)
          .values({
            ...normalized.values,
            activityId,
            createdBy: userId,
            updatedBy: userId,
          } as typeof activityResource.$inferInsert)
          .returning({ id: activityResource.id });
        resourceId = created.id;
      } else {
        // 关联已有资源。先锁再校验再写——顺序同台账页 /update 里那段注释：
        // 校验失败时本函数是**返回**错误而不是抛异常，如果先改字段，外层
        // 事务照常提交，就会留下"字段改了但关联没建"的半保存状态。
        const [existing] = await tx
          .select({
            activityId: activityResource.activityId,
            resourceType: activityResource.resourceType,
            status: activityResource.status,
          })
          .from(activityResource)
          .where(eq(activityResource.id, entry.resourceId))
          .for("update");

        if (!existing) return invalid("所选资源记录不存在", path);
        if (existing.activityId !== activityId) {
          return invalid("所选资源不属于当前活动", path);
        }
        if (existing.resourceType !== demand.resourceType) {
          return invalid("所选资源的类型与本条需求不一致", path);
        }

        if (entry.fields) {
          const normalized = normalizeResourceFields(
            demand.resourceType,
            entry.fields,
            `${label}第 ${index + 1} 条`,
          );
          if (!normalized.ok) return invalid(normalized.message, path);

          await tx
            .update(activityResource)
            .set({ ...normalized.values, updatedBy: userId })
            .where(eq(activityResource.id, entry.resourceId));
        }

        resourceId = entry.resourceId;
      }

      // 关联本身走 checkDemandsLinkable 再过一遍：类型上面已经比过了，这里
      // 兑现的是"`仅记录需求` 不能挂资源"那一条，规则只有那一份实现。
      const problem = await checkDemandsLinkable(
        tx,
        activityId,
        demand.resourceType,
        [demandId],
      );
      if (problem) return invalid(problem, path);

      await ensureDemandLink(tx, {
        demandId,
        resourceId,
        activityId,
        userId,
      });

      // 绑定：增量增删，**绝不整表替换**。这条车上可能绑着不属于本环节的人，
      // 页面看不到他们，按页面状态替换就是静默删数据。
      if (entry.kind === "existing" && entry.unbindIds.length > 0) {
        await unbindResourceMembers(tx, entry.unbindIds);
      }

      if (entry.bindTargets.length > 0) {
        const activityMemberIds: number[] = [];
        for (const target of entry.bindTargets) {
          if ("activityMemberId" in target) {
            activityMemberIds.push(target.activityMemberId);
            continue;
          }
          const resolved = activityMemberIdByTempKey.get(target.memberTempKey);
          if (resolved === undefined) {
            return invalid("绑定的人员尚未加入本环节，请刷新后重试", path);
          }
          activityMemberIds.push(resolved);
        }

        const bindProblem = await bindResourceMembers(tx, {
          resourceId,
          activityMemberIds,
          userId,
        });
        if (bindProblem) return invalid(bindProblem, path);
      }
    }

    // 解除关联：资源留在台账里，只是不再服务这条需求。
    for (const id of demand.unlinkResourceIds) {
      await removeDemandLink(tx, demandId, id);
    }
  }

  // --- 6. 作废资源 ------------------------------------------------------
  // 放在最后：作废之后就不能再绑人了，先作废再处理上面那些会互相打架。
  // 作废**不解除关联**——需求项的配置状态是现算的，作废资源自然不再计入。
  const voidIds = demands.flatMap((d) => d.voidResourceIds);
  if (voidIds.length > 0) {
    await tx
      .update(activityResource)
      .set({ status: "voided", updatedBy: userId })
      .where(
        and(
          inArray(activityResource.id, voidIds),
          // 带上 activityId：资源 id 是全局的，不限定就能作废别的活动的资源。
          eq(activityResource.activityId, activityId),
        ),
      );
  }

  return { kind: "ok", segmentId: realSegmentId };
}

/** ladder 的业务失败以异常形式抛出，翻译成本模块的返回值形状。 */
export function translateLadderError(
  error: unknown,
): SaveSegmentConfigResult | null {
  return error instanceof MemberLadderError
    ? invalid(error.message, "members")
    : null;
}
