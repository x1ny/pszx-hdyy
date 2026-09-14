---
status: reference
summary: 前后端指南分流和双宿主 skill 入口的验证记录，含实测范围与未验证项
read_when:
  - 复核本轮知识入口调整的实际发现和行为证据
  - 补做 Claude Code 自动调用或扩展任务抽样
---

# Agent 指导入口验证（2026-09-14）

变更基于 `a220c2b`。当前维护方式见 [Skill 工作流](skill-workflow.md)，决策见 [ADR](architecture-decisions.md#agent-资料按任务分流与宿主入口2026-09-13)。本记录区分静态约束、宿主发现和模型实际行为；不把其中一种通过当作另外两种通过。

## 静态检查

- `bun run docs:check`：根入口与当前专题链接通过，AGENTS 为 5,675 UTF-8 字节。旧结构文档为 reference 兼容索引；前端、后端、Web UI 指南分别发现。
- `bun run skills:check`：两份项目 skill 的名称、描述、正文链接与 Claude 薄入口一致。
- skill-creator 的 `quick_validate.py`：两份规范 SKILL 均通过；Python 校验依赖仅放本机临时目录，没有加入项目依赖。
- `bun test scripts`：17 通过，包括新增 5 项入口测试。覆盖描述漂移、CRLF、引用断链、错误来源、调用策略，以及不覆盖手写入口、不自动删除失去来源的入口。
- `bun run typecheck` 和新增脚本的只读 Biome 检查通过。
- 全仓 `bun run test`：847 通过，3 个既有失败，仍为 invitation 商会真实模板用例；未改变业务实现或放宽测试期望。

## 宿主原生发现

2026-09-13 在本机验证：

| 宿主 | 实际操作 | 观察结果 | 能证明的范围 |
| --- | --- | --- | --- |
| Codex 0.153.4 | 临时 app-server 的 `skills/list`，对仓库根、apps/server、apps/web、apps/h5 分别 forceReload | 四个工作目录都返回 `.agents/skills` 下两份技能，新描述生效、enabled 为 true、errors 为空 | 原生发现与元数据解析；没有触发模型任务 |
| Claude Code 2.1.260（Windows 桌面版内置 CLI） | 非交互 `/context` | Project skills 显示 shadcn 与 table-ordering；项目记忆只显示 CLAUDE 与 AGENTS，未展开 UI 专题 | 薄入口被发现，根导入链正常；个人 auto-memory 仍独立存在 |
| 同一 Claude Code | 启动事件的 slash_commands | table-ordering 可见，shadcn 不在用户菜单 | 保留了 shadcn 的 user-invocable: false 策略，菜单隐藏不等于模型不可见 |

这次启动在非交互环境执行 `/skills` 返回“不支持该环境”，因此改用 `/context` 核验，未把失败命令作为通过证据。官方依据见 [Codex skill 文档](https://learn.chatgpt.com/docs/build-skills)、[Claude Code skill 文档](https://code.claude.com/docs/en/skills)。

## 独立只读任务抽样

2026-09-14 使用三个独立 Codex 子代理，每个只收到业务任务、仓库路径和只读限制，没有提供预期 skill 名、答案或本次修改结论。以下依据它们的实际读取清单、代码定位和最终方案，不是关键词匹配测试；各任务均未修改业务文件。

| 任务 | 实际阅读与结果 |
| --- | --- |
| 管理端用户编辑弹窗增加保存加载、成功和失败反馈 | 读取 shadcn 正文、web-ui、CRUD 指南和本地组件。发现功能已存在，保留 TanStack Form、Sonner、现有 isPending 接线；没有新增反馈库或重复实现 |
| supplier 列表仅后端改为名称升序，接口不变 | 读取后端结构、开发工作流及 CRUD 后端相关摘录；只核对两个 skill 的描述，未加载正文。定位真实查询、同名稳定顺序及旧注释/规范的影响，没有套用人工 sortIndex |
| H5 行程详情弹层关闭后返回触发元素焦点 | 读取前端结构、H5 指南及工作流相关资料；没有读取 SKILL 正文。核对本地 Base UI 类型及触发入口，方案留在 H5 路由本地，未引入管理端 shadcn 或主题 |

后端任务仍可能按节读取包含后端规则的 CRUD 专题；本轮实现的是按任务选择正文，不承诺与前端有关的标题、描述或文件名完全不可见。已经读取的会话上下文也不会自动卸载。

## 未验证与后续复验

Claude 非交互业务提示返回 `Not logged in`，没有执行模型推理。因此尚未证明它会自动调用 shadcn、跟随薄入口读到规范正文并正确执行。本轮没有修改个人登录或全局配置。

在已登录的 Claude Code 新会话中，重复上述三个只读提示，观察 `Skill` 调用及规范源文件读取。管理端正例需要确认薄入口之后读取 `.agents/skills/shadcn/SKILL.md` 和当前 UI 指南；H5 与纯后端负例不应加载该正文。若持续漏读，再按 ADR 重审适配方式。

人工排序的正例、跨端 API 变更的组合读取尚未做独立行为抽样。以上调查没有实施功能或运行真实浏览器，不能证明业务交互通过，也不是 skill 带来的效率或正确率提升的统计评测。
