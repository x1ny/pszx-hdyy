---
status: current
summary: 项目 skill 的范围、Codex 与 Claude Code 入口、同步和行为验收
read_when:
  - 新增、更新或排查项目 skill
  - 调整 Agent 资料加载、宿主兼容或验证 skill 触发行为
---

# Skill 工作流

项目 skill 正文只维护在 `.agents/skills/<name>/SKILL.md`，持久规则放所属当前专题，skill 负责按任务选择资料与执行步骤。上游资料用于补足技术用法，不能自动代替项目已采纳的约定。

## 现有范围

| Skill | 应使用 | 不应因相似词触发 |
| --- | --- | --- |
| [shadcn](../.agents/skills/shadcn/SKILL.md) | apps/web 管理端组件、表单、视觉与 UI 反馈 | 纯后端、数据库、文档治理、H5、只改数据查询 |
| [table-ordering](../.agents/skills/table-ordering/SKILL.md) | 用户填写 order 或拖拽业务行的人工先后顺序 | 任意列升降序、查询 orderBy、环节时间排期 |

Intent 是依赖包 skill 的发现机制；本表是项目 skill，两者并存。遵守根入口的 Intent 检查，匹配具体包/任务才加载正文，不因发现多个 skill 就全读。

## 两种宿主的入口

Codex 原生发现 `.agents/skills/`。Claude Code 使用已提交的 `.claude/skills/<name>/SKILL.md` 薄入口：只包含同步的名称、描述、调用策略和指向规范正文的读取指令。首次使用会多一次文件读取，但不复制正文及上游参考目录；新 worktree 检出后即可发现入口，无需本机链接或安装 hook。

薄入口不是全文导入语法，Agent 必须执行其中的读取步骤；静态检查只能证明入口和链接有效，实际读取需查看宿主工具记录。`CLAUDE.md` 仍仅包含 `@AGENTS.md`，不能展开导入全部 skill 或专题。

shadcn 保留原有 Claude 自动调用策略：`user-invocable: false`，不出现在用户 `/` 菜单；table-ordering 保留默认的用户和模型均可调用。规范源通过字符串元数据 `metadata.claude-user-invocable` 表达 Claude 专属选项，生成器将其映射到宿主字段。它不关闭 Codex 的自动选择，也不向任一宿主授予额外工具权限。

## 修改与同步

1. 修改 `.agents/skills/` 中的规范源；规则变化先更新所属专题，操作入口只保留必要指针。新的 description 写清任务与边界，避免“仓库存在某个配置文件就使用”这类宽泛条件。
2. 运行 `bun run skills:sync` 生成/更新薄入口，一并提交。正文变化无需复制，新增 skill 或描述、调用策略变化需要同步。命令不联网、不改用户全局配置、不覆盖同名手写入口，也不自动删除过期入口。
3. 运行 `bun run skills:check`、`bun run docs:check` 和对应文件检查。skill 检查已纳入 `bun test scripts` 及根测试，缺失入口、描述漂移、无来源入口、源正文的本地断链会失败。生成器不会执行 skill 中的命令。
4. 修改触发条件或宿主机制时，用下面的任务抽样验证实际行为；只改错字不必重复跑模型验收。

shadcn 的 `rules/`、`cli.md`、`registry.md`、`customization.md` 保留既有上游参考。迁移前快照可从 Git 提交 `a220c2b` 复核；这只是本仓库基线，不冒充上游发布版本。更新上游时记录来源与实际版本，重新核对 Sonner、表单、主题和本地组件定制；不要整包替换项目 SKILL 入口。

## 行为验收

本轮已验证范围和待补项见 [2026-09-14 验证记录](agent-guidance-validation-2026-09-14.md)；它是一次抽样记录，不代替未来宿主升级后的复验。

在新会话给出真实任务，先让 Agent 只读调查并说明准备修改的位置；不要把预期 skill 名或答案塞进自动选择的测试提示。观察它实际读了什么、调用了哪个 skill，以及方案是否保留项目选择。没有可调用 CLI 时明确标记未验证，不把链接检查称为宿主验证。

| 代表任务 | 观察点 |
| --- | --- |
| 优化 supplier 后端查询，保持接口不变 | 能定位后端结构和相关契约；无需 Web UI 或 shadcn 正文 |
| 管理端用户表单加保存反馈与加载状态 | 发现 shadcn，读管理端 UI，沿用 TanStack Form/Sonner 和本地组件 |
| H5 行程详情弹层调整 | 读取 H5 交互资料，不套用管理端 shadcn 与主题 |
| 活动人员名单增加手填顺序和拖拽 | 发现 table-ordering，定位实际消费者与排序契约 |
| 列表按姓名升序 | 不套用人工 sortIndex 模型 |
| 改变服务端返回结构并保持两端可用 | 查 API 契约及实际调用方，必要时组合两端资料 |

名称和描述可在任务开始时可见；完整正文按使用加载。当前会话已经读过的资料不会因下一步只改后端而自动消失，因此负例应使用新会话。一次抽样不能保证所有模型、宿主版本和提示都准确选择；重复误触发时依据记录收窄入口，不能继续给根 AGENTS 堆规则。

## 官方依据

- [Codex skill 发现与渐进加载](https://learn.chatgpt.com/docs/build-skills)：项目 `.agents/skills`，名称/描述先于正文；工作目录会影响发现范围。
- [Claude Code skill 配置与调用控制](https://code.claude.com/docs/en/skills)：项目 `.claude/skills`、description 和 user-invocable 的语义，以及应区分触发与执行结果的验收。

两端都支持链接目录，但本仓库采用可提交的薄入口，减少 Windows Git 链接权限与 worktree 路径差异。重审条件是该额外读取被实测频繁漏掉，或官方提供可直接共享且已验证的项目发现入口。
