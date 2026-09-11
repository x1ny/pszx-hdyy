import { asc } from "drizzle-orm";
import { activityMember } from "./schema";

/**
 * 活动人员名单的**唯一**读取顺序：可见排序值 → 隐藏位置 → id。
 *
 * 运营在活动人员页排出来的先后，是这场活动人员的规范顺序；凡是把这批人
 * 摆成列表给人看的地方（下拉、选人弹窗、排位候选、环节名单、资源已绑人员）
 * 都必须用它，否则同一批人在不同页面会是三种顺序，"我排好的名单"就只在
 * 一个页面成立。判据是"这个列表的元素是不是活动人员"，不是"这条查询写在
 * 哪个模块里"——所以 agenda / trip / seating / resource / invitation 都直接
 * import 这里，不各写一遍。
 *
 * 数据源是人员主档或项目人员的列表**不适用**（`member/candidates` 的 `all`
 * 和 `project` 分支就是这种），那些不是这场活动的名单。
 *
 * `sortOrder` 可空，NULL 表示"未设置"。Postgres 的 `ASC` 默认就是 NULLS
 * LAST，未设置的人自然排在所有填了数字的人后面——这是**依赖默认值**的一条
 * 规则，别改写成 `asc(...) nulls first` 或给 NULL 补 `coalesce`。
 *
 * ⚠️ 同一条规则在仓库里还有一份纯 TS 实现：`plan-manual-order.ts` 的
 * `byManualOrder`（排序计划函数不碰数据库，不能用 drizzle 的 `asc`）。改这里
 * 就要一起改那里，`activity-member-order-by.test.ts` 会盯着两边不许分叉。
 *
 * 用法：`.orderBy(...activityMemberOrderBy)`。环节层等"活动顺序之内再排"的
 * 场景在后面追加自己的兜底列，例如
 * `.orderBy(...activityMemberOrderBy, asc(segmentMember.id))`。查询必须已经
 * join 了 `activityMember`，没 join 的（如只连 `resourceMemberBinding` 的那条）
 * 要先把它 join 进来。
 */
export const activityMemberOrderBy = [
  asc(activityMember.sortOrder),
  asc(activityMember.sortIndex),
  asc(activityMember.id),
] as const;
