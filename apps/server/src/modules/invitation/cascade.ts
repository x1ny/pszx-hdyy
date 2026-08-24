import { and, asc, eq } from "drizzle-orm";
import type { db } from "../../infra/db";
import { activityMember } from "../member/schema";
import { invitationBatch, invitationRecord } from "./schema";

/**
 * invitation 对外暴露的**级联出口**，专供 member 在移除活动人员时调用。
 * 结构和理由跟 `seating/cascade.ts` 完全一致，见那个文件的说明。
 *
 * `invitation_record` 对 `activity_member` 的复合外键**故意没有 cascade**——
 * schema.ts 里那段注释写得很清楚："移除活动人员时数据库会拦住。这是要的行为——
 * 文档要求移除人员时『展示清单并二次确认』后才解除邀请函等下游关联，那个确认
 * 动作应该显式删记录，而不是让一次误删悄悄带走一批公函留痕。"
 *
 * **拦是拦住了，但那个"展示清单 + 显式删"一直没实现**，于是 `activityMember/remove`
 * 一碰到发过邀请函的人就报 500。这个文件补的就是缺掉的那一半。
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 这个活动人员名下有哪些邀请函记录。给 member 的 `/impact` 和二次确认文案用。 */
export async function listInvitationsByActivityMember(
  conn: Pick<typeof db, "select">,
  activityMemberId: number,
) {
  return conn
    .select({
      id: invitationRecord.id,
      recipientName: invitationRecord.recipientName,
      batchName: invitationBatch.batchNo,
    })
    .from(invitationRecord)
    .innerJoin(
      activityMember,
      and(
        eq(activityMember.activityId, invitationRecord.activityId),
        eq(activityMember.memberId, invitationRecord.memberId),
      ),
    )
    .innerJoin(
      invitationBatch,
      eq(invitationBatch.id, invitationRecord.batchId),
    )
    .where(eq(activityMember.id, activityMemberId))
    .orderBy(asc(invitationRecord.id));
}

/**
 * 删掉这个活动人员的全部邀请函记录。**只在用户已经看过清单并二次确认之后调用。**
 *
 * 删的是 `invitation_record`（发给谁的那条），不动 `invitation_batch`
 * （那一批公函本身），批次的存在和它的模板/变量快照都保留。
 */
export async function releaseInvitationsByActivityMember(
  tx: Tx,
  activityMemberId: number,
): Promise<number> {
  const [target] = await tx
    .select({
      activityId: activityMember.activityId,
      memberId: activityMember.memberId,
    })
    .from(activityMember)
    .where(eq(activityMember.id, activityMemberId));
  if (!target) return 0;

  const deleted = await tx
    .delete(invitationRecord)
    .where(
      and(
        eq(invitationRecord.activityId, target.activityId),
        eq(invitationRecord.memberId, target.memberId),
      ),
    )
    .returning({ id: invitationRecord.id });

  return deleted.length;
}
