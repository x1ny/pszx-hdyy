# 活动人员名单排序实施记录

执行依据：[业务绑定与任务卡](activity-member-ordering-model-plan.md)、[table-ordering Skill](../.agents/skills/table-ordering/SKILL.md)。2026-09-10 用户授权实施、独立子 agent 和并行工作；现已指定所有执行统一使用 GPT-5.6 Luna + Max。

## 分工与状态

| 阶段 | 执行者配置 | 归属与状态 |
| --- | --- | --- |
| AM00 | Luna Max（以已有边界结论为输入） | 边界已核对；后续不重复大范围调研 |
| AM01 | Luna Max | member 纯排序函数与测试，已完成；8 个测试通过，类型检查与 Biome 通过 |
| AM02 | Luna Max | 后端关系排序、所有新增入口、迁移与种子，已完成；服务端成员模块 118 个测试通过 |
| AM03—AM04 | Luna Max，同一执行者 | 页面、查询适配、拖拽与前端测试，已完成；页面定向测试 10 个通过 |
| AM05 | Luna Max＋主 agent 验证 | 已完成；独立审查、临时数据库和真实浏览器证据已记录，限制见下文 |

算法、后端、前端按文件归属并行，不同时修改相同文件；后端与前端使用已固定接口。无需每阶段新建执行者或重新阅读全部研究材料。主 agent 维护本文及其他文档、开发环境和 Git。

## AM00 关键结论

- 两个线上插入 helper 覆盖活动直接添加、组织添加、旧环节入口和新环节整页保存，必须同时维护新增顺序。
- 组织批量补齐旧关系的 NULL 组织快照仍是正常业务编辑，应保留原有审计更新；仅排序字段必须保持。
- `ladder.test.ts`／`organization-batch.test.ts` 使用 fakeTx；`routes.test.ts` 主要检查 SQL 和登记；原名单测试没有整页分页状态覆盖。它们不代替真实数据库、分页和浏览器证据。
- 翻页旧数据占位、排序保存刷新失败期间禁止移动；`allEnabled` 也消费顺序，需要刷新。

## 检查证据

本次实现和应用验收已完成。所有实施、修复和最终审查均按用户最新要求使用 GPT-5.6 Luna + Max；更早的边界审查曾使用 Astra，只作为输入保留，未用于本次编码执行。

- 算法：`bun test apps/server/src/modules/member/plan-manual-order.test.ts`，8 pass；服务端类型检查通过。
- 后端：`bun test apps/server/src/modules/member`，118 pass；`bun run --filter '@repo/server' typecheck` 通过；`bun run --filter '@repo/server' db:generate` 无 schema drift。
- 前端：活动人员页面定向测试 12 pass，web 类型检查通过；全 web 测试 284 pass；构建通过。
- 临时数据库：迁移和种子成功；`activity_member.sort_order` 为可空 integer，`NULL` 表示未设置，`sort_index` 为非空 integer，复合索引为 `(activity_id, sort_order, sort_index, id)`。真实操作后活动 1 有 51 条关系，排序结果按接口顺序读取，同一活动没有重复 `(sort_order, sort_index)` 组合。
- 真实浏览器：验证数字保存后行位置刷新、上移、鼠标拖拽、空位置拖拽取消、键盘 Space/连续方向键拖放，以及应用筛选后禁用移动但仍允许编辑数字；筛选后的数字保存也成功。另验证移动接口失败时重建拖拽树并恢复服务端顺序的代码路径。

## 拖拽保存补充修复

首次浏览器复验发现一个只在快速释放或同一目标内跨过中心时出现的窗口：dnd-kit 可能先完成视觉换位，随后才调度最后一次指针移动，`dragend` 的目标会变成源行或空值，导致旧的 `before/after` 意图被判定为无变化而不发请求。

当前页面在拖拽结束时用最终指针坐标按活动人员行的几何范围重新识别落点，并读取 `SortableDraggable.index` 作为已发生视觉换位时的稳定兜底；表格外释放仍明确取消，不会保存上一次落点。拖拽结束不再因查询状态在最后一帧变为 pending 而静默丢弃已有会话。新增 sortable index 回归用例；web 类型检查、全量 web 测试（284 项）和生产构建均通过。真实浏览器连续执行同目标上下跨中心 6 次，6 次均发送 `/api/activityMember/move`，表格外释放未发送请求。

已知限制和基线：完整 `bun run test` 保持原有 3 个 invitation 真实模板测试失败，位置和原因见根 `AGENTS.md`，没有新增失败；`bun run db:check` 触发当前 Drizzle introspection 的 `$1::regnamespace` 空参数错误，属于仓库工具基线问题；本轮按用户要求未覆盖并发冲突，也未将 agenda 作为第二个消费者实现。真实浏览器未专门执行“新增人员”界面路径，新增位置分配由 ladder 单元测试、迁移和代码路径检查覆盖。

## 未设置排序值补充变更

根据产品反馈，活动人员的排序值改为可空：未设置时输入框为空并以 `-` 作为占位显示，数据库保存 `NULL`，列表按 `sortOrder ASC NULLS LAST, sortIndex ASC, id ASC` 读取。新加入活动的关系默认进入未设置组末尾；输入 0 可将该行置于未设置人员之前；清空已填写数字可恢复为未设置。迁移 `0008_lame_maelstrom.sql` 将首版默认生成的旧 0 按“未设置”转换为 NULL。

临时数据库实测：活动 1 第 6 页首行关系 id=51 设为 0 后，第 1 页首行变为 id=51；再清空为 NULL 后接口返回 `sortOrder: null`，证明最后一页记录可以通过可见排序值进入首位。

## 读取出口统一（2026-09-11）

首版只有活动人员页自己按新顺序读，其余引用这批人的列表各排各的。临时库实测
（活动 1，把陈静设为 1、赵磊设为 2）：名单是"陈静、赵磊、王芳…"，行程下拉是
"何伟、傅杰、冯凯…"（`member.name` 在 Postgres 默认排序规则下对中文就是码点序，
对用户等于随机），选人弹窗的"本活动人员"标签页是"贺敏、陆瑶、曾诚…"（加入
时间倒序）。同一批人三种顺序，运营排的那一次只在一个页面成立。

**规则：一个列表的元素是活动人员，它就按活动人员名单的顺序读。** 判据是列表里
装的是什么，不是这条查询写在哪个模块。SQL 那一份实现在
`apps/server/src/modules/member/activity-member-order-by.ts`，用法
`.orderBy(...activityMemberOrderBy)`；环节层等"活动顺序之内再排"的在后面追加
自己的兜底列。查询没 join `activityMember` 的，为排序 join 进来即可——
`segmentMember.activityMemberId` 和 `resourceMemberBinding.activityMemberId`
都非空，inner join 不丢行。

数据源是人员主档或项目人员的列表**不适用**（`member/candidates` 的 `all` /
`project` 分支、`/api/member/list`），那些不是这场活动的名单。

本次接线的出口：

| 出口 | 原顺序 |
| --- | --- |
| `member/candidates` scope=`activity`（选人弹窗"本活动人员 / 活动人员库"标签页） | `desc(member.id)` |
| `trip/options`（行程表单人员下拉） | `asc(member.name)` |
| `tripBatchMembersQuery` 两个分支（行程批量选择器） | `asc(member.name)` |
| `listCandidatesQuery`（排位候选人） | `asc(member.name)`，且无 tiebreaker——LIMIT 200 的截断点原先不稳定 |
| `segmentMember/list`（环节人员名单） | `asc(segmentMember.id)` |
| `agenda/getSegmentConfig` 的 members（环节配置单页人员区，同时是资源绑人下拉的候选） | `asc(segmentMember.id)` |
| `listSegmentConfigResourceBindingsQuery`、`resource/get` 的 members（已绑人员） | `asc(resourceMemberBinding.id)` |
| invitation 团体摘要 | `asc(activityMember.id)`；**顺序有业务语义**——团体联系人取名单里第一个填了负责人的人 |

`activityMember/list` 原本就对，改成引用同一个常量，规则从此只有一份。纯 TS 那份
（`plan-manual-order.ts` 的 `byManualOrder`）以前被 `activity-member-ordering.ts`
抄了第二遍，现在导出复用。

护栏是 `activity-member-order-by.test.ts`：钉住 SQL 渲染文本、断言纯函数和 SQL
是同一条规则、检查已接线的三个导出查询构造器、扫描源码不许有人再拼一遍
`asc(activityMember.sortOrder)`。已反向验证不是空防（改坏任一处会红）。**它挡不住
"新写一条返回活动人员的查询、压根没排序"**——没有运行时注册表能枚举"哪些查询
返回的是人员名单"，权限闸门能有 `permission-map` 那种遍历 `app.routes` 的断言，
是因为路由本身就是一张表。这个缺口只能靠本节和那个文件的注释兜，别为了补上它
去造一层排序注册中心。

检查：`bun test apps/server/src` 519 pass / 3 fail（invitation 真实模板，master
上同样红，见根 `AGENTS.md`）；`bun run typecheck` 三个包全过。
## 排序列交互重做（2026-09-11）

**这一节作废两处旧验收项**：模型方案第 4 节写的「排序输入及保存／取消、可访问的
上移／下移入口」，和任务卡 T06 第 5 条的「上移／下移入口保留」。原因是 AM 系列交付
后用户反馈这一列"不好看"，实际去看也确实站不住：

- `sortOrder` 可空之后绝大多数行是空的，那一列变成 50 个画着 `-` 的常驻输入框，
  视觉噪音全部来自"没有值"的行；
- 拖拽手柄和上下移按钮在最右侧操作列，而这张表宽到要横向滚动——用户看着"排序"
  列，找不到任何可操作的东西；
- 「保存／取消」是随草稿出现的，一敲键盘整列就变宽，列宽还得按"有按钮时"预留。

改成（参考 Notion/Linear/Airtable 的行首 gutter 与表格行内编辑契约）：

- 手柄移进排序列、紧挨序号，常驻但压低对比度，悬停整行时提亮；
- 数值输入静止时就是一格文本，悬停才浮出边框，**回车或移开光标提交，Esc 撤销**，
  「保存／取消」按钮删除。Enter 走 `blur()` 而不是直接提交——两条路径各提交一次
  的话一次编辑会发两个请求；
- 保存期间的 `disabled` 从整列收窄到正在保存的那一行，否则连改两行时第二行会被
  锁住（这是失焦提交带来的新问题，旧的点按钮保存没有）；
- **上移／下移按钮撤下**。顺序调整走拖拽，以及手柄上的键盘拖放（KeyboardSensor，
  `createActivityMemberMoveIntentFromSequences` 就是为它写的），所以撤掉按钮没有
  留下"只能用鼠标"的可达性缺口。`createActivityMemberAdjacentMoveIntent` 保留：
  撤下的是入口不是能力，它现在只有测试在调用。

没有动任何提交协议：前端仍然发稳定关系 ID + 前／后锚点意图，渲染 index 仍然不落库。

检查：`bun run typecheck` 三个包全过；`@repo/web` 289 测试全过；真实浏览器（临时库）
验证了拖拽、回车提交、失焦提交、Esc 撤销不发请求、连改两行、表头说明 tooltip，
无 console 报错。
