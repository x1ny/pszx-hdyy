import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../../infra/db";
import { activitySegment } from "../agenda/schema";
import { segmentSeatingPlan } from "./schema";

/**
 * 排位的活动级汇总。存在的理由和 `resource/stats.ts` 的 `summarizeDemands`
 * 一样，但更具体：**"哪些环节算开了排位"这条规则已经漂移过一次。**
 *
 * `routes.ts` 的 `listPlans` 早先是硬过滤 `seatingEnabled = true`，把开关当成了
 * 列表的筛选条件；后果是排完位再回议程页关掉开关，那一行就从列表里消失，可
 * 方案还在库里占着唯一索引、场地空间页还显示那块区域"被开幕式引用"、区域因此
 * 还删不掉——用户看得见后果，却找不到入口作废它（评审 §3.4）。
 *
 * 那次修复只需要改一处。要是当时活动配置总览已经把同一条规则抄了一遍，必然
 * 漏掉一处，而漏掉的表现是总览说"还差 1 个环节没排位"、用户点进排位页找不到
 * 那一行。所以下面两个片段是**规则本身**，两个读者都从这里取。
 */

/**
 * 环节 → 当前方案的左连接条件。**作废方案不算当前方案**，所以排除写在连接
 * 条件里而不是 where 里——写在 where 里会把"只有一份作废方案"的环节整个滤掉，
 * 而那个环节该以「未配置」出现。
 */
export const currentPlanJoin = and(
  eq(segmentSeatingPlan.segmentId, activitySegment.id),
  sql`${segmentSeatingPlan.status} <> 'voided'`,
);

/**
 * 「这个环节算不算在排位范围内」：**开关开着 或 已经有非作废方案**。
 *
 * 两者是独立的事实，用前者过滤后者就会漏（见上面那段）。依赖 `currentPlanJoin`
 * 已经把作废方案排除掉，所以这里的 `isNotNull` 就等于"有一份在用的方案"。
 */
export const inSeatingScope = or(
  eq(activitySegment.seatingEnabled, true),
  isNotNull(segmentSeatingPlan.id),
);

export type SeatingSummary = {
  /** 适用环节数，也就是配置总览里那个"N 个环节开启排位"。 */
  applicable: number;
  /** 连一份非作废方案都没有的环节数。 */
  unconfigured: number;
  pending: number;
  confirmed: number;
  rejected: number;
};

/**
 * 一个活动的排位分布。
 *
 * 作废环节一律排除，和排位页 `index.tsx` 的 `visible` 过滤同一口径——那个过滤
 * 之所以留在客户端，是因为议程页也吃 `listPlans` 的结果、要拿作废行显示历史
 * 状态（`routes.ts` 的注释），所以服务端不能滤。这里是另一个读者，自己滤一行。
 */
export async function summarizeSeating(
  activityId: number,
): Promise<SeatingSummary> {
  const rows = await db
    .select({ planStatus: segmentSeatingPlan.status })
    .from(activitySegment)
    .leftJoin(segmentSeatingPlan, currentPlanJoin)
    .where(
      and(
        eq(activitySegment.activityId, activityId),
        eq(activitySegment.status, "active"),
        inSeatingScope,
      ),
    );

  const summary: SeatingSummary = {
    applicable: rows.length,
    unconfigured: 0,
    pending: 0,
    confirmed: 0,
    rejected: 0,
  };

  for (const row of rows) {
    if (row.planStatus === null) summary.unconfigured += 1;
    // voided 进不来：它被 currentPlanJoin 挡在连接条件外，只会以 null 出现。
    else if (row.planStatus !== "voided") summary[row.planStatus] += 1;
  }

  return summary;
}
