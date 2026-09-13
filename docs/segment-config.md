---
status: current
summary: 环节配置的增量意图、整页事务及新旧编辑入口约束
read_when:
  - 修改环节或议程的编辑、人员、需求、资源保存
  - 调整新旧环节配置入口、草稿或事务编排
---

# 环节配置保存契约

## 当前入口与实现

议程默认进入单页配置；旧编辑代码和详情回退仍保留。两条路径写同一批表，入口切换不代表旧的写路径已经移除。

- 服务端编排：[segment-config.ts](../apps/server/src/modules/agenda/segment-config.ts)，入参在同模块 [validation.ts](../apps/server/src/modules/agenda/validation.ts)。
- 前端草稿：[`-draft.ts`](../apps/web/src/routes/_authenticated/project/$projectId_.activity.$activityId.agenda.$segmentId/-draft.ts)。
- 新页面通过 `getSegmentConfig` 读取、`saveSegmentConfig` 原子保存。返回错误的字段路径用于定位页面区块。

## 必须保持的写入语义

人员和资源绑定提交增量意图（`add`、`remove`、`bindTargets`、`unbindIds`），不能改成完整目标名单覆盖。否则一个打开已久的草稿会在保存时删掉别人通过旧入口新增的人员或绑定。资源需求矩阵拥有完整视野，仍按既有约定整体替换，不能把所有字段一律改成增量。

草稿中新对象用 `tempKey` 引用，由一次事务解析为真实 ID；临时键不落库。资源类型跟随需求，不增加与需求独立的选择。按团体添加必须复用人员模块的批处理和历史快照冲突规则，不展开为逐人添加来绕开冲突判断。

保存编排只组织顺序和引用解析，业务规则继续复用人员层级、资源需求和环节写入原语。必须保持两条顺序：

1. 先写环节，再加人员。人员规则会重新读取 `memberEnabled`，同时“开开关＋加人”不能被旧状态拒绝。
2. 先整体更新需求项，再挂资源安排。资源需要引用该轮 upsert 得到的需求 ID。

这些约束也在编排文件顶部就地说明。修改事务边界、草稿载荷或旧入口时，先核对这份契约。

## 验证与后续收敛

自动用例：[后端编排测试](../apps/server/src/modules/agenda/segment-config.test.ts)、[前端草稿测试](../apps/web/src/routes/_authenticated/project/$projectId_.activity.$activityId.agenda.$segmentId/-draft.test.ts)。事务回滚、不同入口交替编辑、同次开关与加人、按团体冲突应按任务在临时库复验；纯函数/Mock 测试不代表真实事务已验收。

并存不等于所有字段都具备并发覆盖保护。基础字段、需求整体替换等仍需按其当前写入语义理解。要收敛旧入口或改变并发策略，先确定真实入口及消费者，再更新本契约、就地注释和验收。

设计原因、当时接受的代价和旧文件收敛清单保留在 [ADR 对应条目](architecture-decisions.md#环节配置合并为单页整页原子保存)。历史实施状态不自动覆盖当前代码与本契约。
