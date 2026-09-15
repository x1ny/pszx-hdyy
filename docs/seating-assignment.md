---
status: current
summary: 个人与团体多座分配、人数统计、换位及下游展示契约
read_when:
  - 修改排座、排位、人员占位、座位分配或换位
  - 修改已排人数、座位名单、解除占位或人员移除
---

# 座位分配

同一方案内，个人和团体都可以占多个座位。2026-09-14 按用户需求取消个人的一人一座限制；决策依据见 [ADR](architecture-decisions.md#个人可占多个座位)。几何与区域规则仍见 [座位画布](seating-canvas.md)。

## 写入与解除

- `assign` 和 `assignActivityMember` 只替换目标座位的占用，不撤掉该人员其他座位。重复分配同一座位仍只有一条有效占用。
- `unassign` 只解除指定座位。`swap` 只对调指定两个位置，目标为空时是移动，其他座位保留；个人目标的 `organizationId` 仍为空，团体快照仅用于展示及确认日志。
- 每座最多一个有效占用对象，数据库部分唯一索引继续保证。人员和团体的环节归属校验、停用和软删位置限制不变。
- 人员从环节或活动移除时，影响清单包含其全部座位；既有级联出口清理全部分配及关联历史，并保留其他占用对象。
- 修改已确认方案后仍回到待确认，H5 只读取已确认方案；确认日志按座位保存全部分配。

## 数量与展示

- 排位总览的“排座情况”显示 `assignedPersonCount / totalMemberCount`：前者只统计当前方案中仍有效的个人分配，并按环节人员去重；后者统计该环节的全部 `segmentMember`。团体占位没有具体人员，不计入已排座人数。
- 团体统计 `assignedPersonCount` 按 `segmentMemberId` 去重；一个人占多座仍只算一个已排人员。`remainingMemberCount = max(0, totalMembers - assignedPersonCount - organizationSeatCount)`。
- 方案 `assignedCount` 与 `assignments.length` 是占用位置数，页面使用“已占位置”，不能标成“人数”。
- 候选人的 `takenSeatLabel`、活动人员详情的 `seatLabel` 保持可空字符串契约，以 `、` 连接全部有效座位，按 `ordinal`、座位 ID 排序。没有座位返回 null；每名候选人、每个参与环节只返回一行。
- H5 行程每个环节一行，展示全部个人座位号；座位图可逐个选择本人座位定位。成员所属团体有占位时，个人座位下方附“您的团体成员座位安排在 …”及排内范围；没有个人排座时，团体范围作为主位置并提供「我的团体座位」图：全区只给无标签灰点，团体占位统一标红。范围按画布的显式排顺序合并，过道不切断连续座号，详见 [H5 座位图](h5-seat-map.md)。

## 数据迁移与交付

迁移删除 `uk_seat_assignment_member`，以同字段和过滤条件的普通索引 `idx_seat_assignment_member` 保留查座能力；不修改已有分配。座位唯一索引、外键及占用对象二选一 CHECK 保留。

旧版本在排人时仍会撤销该人员其他座位，因此部署时应保证所有实例都更新后再开始多座排位。存在多座数据后直接回滚到旧应用也会重新触发旧的换座行为；不能把本次行为变更当成新旧应用可混用。

## 验证

单元测试覆盖索引、座位聚合、人数统计查询、候选人可继续排位及 H5 多座坐标与隐私边界。

真实事务验收在 `apps/server/src/modules/seating/multi-seat.integration.test.ts`。先运行 `bun run dev`，将 `SEATING_INTEGRATION_URL` 设为启动输出的管理端 origin，再运行：

```sh
bun --env-file=.env --env-file=apps/server/.dev-db.env test apps/server/src/modules/seating/multi-seat.integration.test.ts
```

该验收要求当前临时库及原始演示排位数据，完成后恢复测试前的人员、分配、状态、座位启用和排位日志。未设置 URL 时日常测试跳过。覆盖连续与并发增座、重复请求、人数去重、人员详情、停用与伪造目标拒绝、单座解除、空位/同人/团体换位、确认后 H5 多座展示及人员移除级联。
