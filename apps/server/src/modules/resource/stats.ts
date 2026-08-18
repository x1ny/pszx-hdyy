import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "../../infra/db";
import { activitySegment } from "../agenda/schema";
import {
  activityResource,
  deriveDemandStatus,
  type DemandStatus,
  resourceDemandLink,
  resourceMemberBinding,
  segmentResourceDemand,
} from "./schema";

// ---------------------------------------------------------------------------
// 派生计数
// ---------------------------------------------------------------------------

/**
 * 相关子查询一律用 drizzle 的查询构造器拼，**不要手写 sql 模板**。
 *
 * 踩过一次，代价很大：手写 `` sql`... where dl.resource_id = ${activityResource.id}` ``
 * 时，drizzle 把列渲染成**不带表名的 `"id"`**（`.select()` 里的列是"选择字段"
 * 语境，它省掉了限定符）。于是子查询里那个裸 `"id"` 按 SQL 的作用域规则绑到了
 * 子查询自己的表上——条件变成 `dl.resource_id = dl.id`，恒假，计数恒为 0。
 *
 * 最坏的地方是它**不报错**：SQL 合法、接口 200、列表照常渲染，只是每一行的
 * 关联数都是 0。手写 SQL 单测时反而是对的（那里会老老实实写 `d.id`），只有
 * 走真实页面才看得出来。
 *
 * `eq(a, b)` 传两个 Column 时两边都会带表名限定，所以查询构造器版本天然正确。
 * `.mapWith(Number)` 是必须的：count 返回 bigint，node-postgres 给回字符串，
 * 而这个值要参与 deriveDemandStatus 里的 `=== 0` 比较。
 */
const scalarCount = (
  query: { getSQL: () => ReturnType<typeof sql> } | ReturnType<typeof sql>,
) => sql<number>`(${query})`.mapWith(Number);

/**
 * 一条需求项关联了几条**正常**的资源记录。
 *
 * 作废的资源不计入：两辆车都作废了，需求就该退回"待配置"。这正是把状态做成
 * 派生量换来的东西——作废接口里一行回写代码都不用写。
 */
export const activeResourceCount = scalarCount(
  db
    .select({ n: count() })
    .from(resourceDemandLink)
    .innerJoin(
      activityResource,
      and(
        eq(activityResource.id, resourceDemandLink.resourceId),
        eq(activityResource.status, "active"),
      ),
    )
    .where(eq(resourceDemandLink.demandId, segmentResourceDemand.id)),
);

/** 这条需求关联的正常资源上，一共绑了多少人次。 */
export const boundMemberCount = scalarCount(
  db
    .select({ n: count() })
    .from(resourceDemandLink)
    .innerJoin(
      activityResource,
      and(
        eq(activityResource.id, resourceDemandLink.resourceId),
        eq(activityResource.status, "active"),
      ),
    )
    .innerJoin(
      resourceMemberBinding,
      eq(resourceMemberBinding.resourceId, activityResource.id),
    )
    .where(eq(resourceDemandLink.demandId, segmentResourceDemand.id)),
);

/** 一条资源记录被几条需求项引用。 */
export const linkedDemandCount = scalarCount(
  db
    .select({ n: count() })
    .from(resourceDemandLink)
    .where(eq(resourceDemandLink.resourceId, activityResource.id)),
);

/** 一条资源记录绑了几个人。 */
export const resourceMemberCount = scalarCount(
  db
    .select({ n: count() })
    .from(resourceMemberBinding)
    .where(eq(resourceMemberBinding.resourceId, activityResource.id)),
);

// ---------------------------------------------------------------------------
// 活动级汇总
// ---------------------------------------------------------------------------

export type DemandSummary = {
  /** 正常环节上的需求项总数。作废环节的不算——它已经不在议程上了。 */
  total: number;
  /** 待办数 = 待配置 + 配置中。活动配置总览就看这一个数。 */
  open: number;
} & Record<DemandStatus, number>;

/**
 * 一个活动的资源需求分布。
 *
 * 存在的理由是**"什么算待办"只能有一处定义**：资源需求汇总页要用它排待办，
 * 活动配置总览要用它判断"资源"这一项配没配齐。两边各写一遍 filter，迟早
 * 出现汇总页说还差 1 项、总览说全配齐了。
 *
 * 作废环节的需求项一律排除，和前端 isOpenTodo 同一口径。
 */
export async function summarizeDemands(
  activityId: number,
): Promise<DemandSummary> {
  const rows = await db
    .select({
      handling: segmentResourceDemand.handling,
      resourceType: segmentResourceDemand.resourceType,
      activeResourceCount,
      boundMemberCount,
    })
    .from(segmentResourceDemand)
    .innerJoin(
      activitySegment,
      eq(activitySegment.id, segmentResourceDemand.segmentId),
    )
    .where(
      and(
        eq(segmentResourceDemand.activityId, activityId),
        eq(activitySegment.status, "active"),
      ),
    )
    .orderBy(asc(segmentResourceDemand.id));

  const summary: DemandSummary = {
    total: rows.length,
    open: 0,
    recorded: 0,
    pending: 0,
    configuring: 0,
    configured: 0,
  };

  for (const row of rows) {
    const status = deriveDemandStatus(row);
    summary[status] += 1;
    if (status === "pending" || status === "configuring") summary.open += 1;
  }

  return summary;
}
