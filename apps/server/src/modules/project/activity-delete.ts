import { eq, inArray } from "drizzle-orm";
import { db } from "../../infra/db";
import {
  activitySegment,
  activitySegmentRevision,
  agendaLine,
} from "../agenda/schema";
import { invitationBatch } from "../invitation/schema";
import { activityMember, segmentMember } from "../member/schema";
import {
  activityResource,
  resourceMemberBinding,
  segmentResourceDemand,
} from "../resource/schema";
import { seatAssignment, segmentSeatingPlan } from "../seating/schema";
import { memberTrip } from "../trip/schema";
import { activity } from "./schema";

/**
 * 活动是其业务配置的聚合根：删除活动时，活动范围内的关系和快照必须一起
 * 清掉，不能把外键冲突转嫁给使用者逐张表手工清理。人员、项目、场地、模板、
 * 文件等可跨活动复用的主档不在此列，只删除它们与活动之间的关系或快照。
 *
 * 所有步骤在同一事务里执行。先锁住活动行，阻止删除过程中插入新的下游引用；
 * 后续按外键的逆序清理，任何一步失败都会整体回滚。
 */
export async function deleteActivityCascade(id: number) {
  return db.transaction(async (tx) => {
    const [lockedActivity] = await tx
      .select({ id: activity.id })
      .from(activity)
      .where(eq(activity.id, id))
      .for("update");

    if (!lockedActivity) return null;

    const segments = await tx
      .select({ id: activitySegment.id })
      .from(activitySegment)
      .where(eq(activitySegment.activityId, id))
      .for("update");
    const segmentIds = segments.map((segment) => segment.id);

    const plans = await tx
      .select({ id: segmentSeatingPlan.id })
      .from(segmentSeatingPlan)
      .where(eq(segmentSeatingPlan.activityId, id))
      .for("update");
    const planIds = plans.map((plan) => plan.id);

    // seat_assignment 对方案和环节人员都是 NO ACTION，必须先于二者删除。
    if (planIds.length > 0) {
      await tx
        .delete(seatAssignment)
        .where(inArray(seatAssignment.planId, planIds));
      // 方案下的布局、座位和操作日志按表定义 cascade 删除。
      await tx
        .delete(segmentSeatingPlan)
        .where(inArray(segmentSeatingPlan.id, planIds));
    }

    // 发函批次删除时，邀请函记录按 batch_id 级联删除。
    await tx.delete(invitationBatch).where(eq(invitationBatch.activityId, id));

    // 行程、资源服务绑定分别同时指向活动人员/环节或活动资源，必须先清理。
    await tx.delete(memberTrip).where(eq(memberTrip.activityId, id));
    await tx
      .delete(resourceMemberBinding)
      .where(eq(resourceMemberBinding.activityId, id));

    // 删除需求会级联 resource_demand_link；资源主记录随后才能安全删除。
    await tx
      .delete(segmentResourceDemand)
      .where(eq(segmentResourceDemand.activityId, id));
    await tx
      .delete(activityResource)
      .where(eq(activityResource.activityId, id));

    await tx.delete(segmentMember).where(eq(segmentMember.activityId, id));
    await tx.delete(activityMember).where(eq(activityMember.activityId, id));

    if (segmentIds.length > 0) {
      // revision 没有外键是为普通环节变更保留历史；永久清除整个活动时它也
      // 属于被明确丢弃的活动数据，避免留下无法追溯到活动的孤儿快照。
      await tx
        .delete(activitySegmentRevision)
        .where(inArray(activitySegmentRevision.segmentId, segmentIds));
    }

    await tx.delete(activitySegment).where(eq(activitySegment.activityId, id));
    await tx.delete(agendaLine).where(eq(agendaLine.activityId, id));

    // activity_media、activity_venue 及其活动空间快照按既有外键 cascade。
    // invitationDownloadLog 刻意没有外键，作为已发生下载的审计记录保留。
    const [deleted] = await tx
      .delete(activity)
      .where(eq(activity.id, id))
      .returning({ id: activity.id });

    return deleted ?? null;
  });
}
