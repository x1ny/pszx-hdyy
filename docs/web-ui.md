---
status: current
summary: 管理端 Web 的 shadcn 组件选型、归属、主题及上游指导适配
read_when:
  - 在 apps/web 新增、组合或修改 UI 组件、反馈、表单和样式
  - 使用 shadcn registry、更新管理端 primitive 或调整组件配置
---

# 管理端 UI

仅适用于 `apps/web`。H5 使用自己的 Base UI 交互与外观，读取 [H5 指南](h5-itinerary.md)；后端内部改动不需要本篇。页面目录与复用阈值见 [前端结构](frontend-structure.md)。

## 已采纳的选择

管理端优先复用现有 shadcn 组件，需要新增 primitive 时再通过 CLI 引入。配置以 [components.json](../apps/web/components.json) 为准：当前是 `base-vega`、Base UI、Lucide、非 RSC，别名为 `#/`；主题入口是 `src/styles.css`。不能套用 Radix 的 `asChild`、Next.js 的 server component 或另一套 alias 示例。

- 表单沿用 TanStack Form 和 Field 系列；校验、错误触达与提交接线见 [CRUD 表单](crud-page-guide.md#表单用-tanstack-form不用-react-hook-form)。不因上游示例改用 React Hook Form。
- 提示沿用已安装的 Sonner，根路由已挂载 Toaster。不能因为上游“Base UI 使用 toast”建议另装第二套反馈系统。
- 维持现有亮色产品方向；不新增深色主题、主题切换或系统色彩跟随。管理端与 H5 的 token 各自维护。
- 优先使用已有语义 token 和 variant；表格分类、状态色、ghost 操作按钮和间距按 [CRUD 视觉规则](crud-page-guide.md#视觉规范) 执行。上游“className 只能布局”不能取消本项目已采纳的颜色与字号调整。
- 组件组合须核对本地 API：可访问名称、键盘操作、焦点返回、错误状态与禁用状态仍需验证，不能只凭上游代码外观判断正确。

这些是项目选择；上游 skill 的说明和组件文档用于查 API 与组合方法，不自动覆盖本篇。确需改变已采纳方向时记录理由与影响，再更新所属指南和 ADR。

## 组件归属

| 层 | 归属 | 更新方式 |
| --- | --- | --- |
| registry primitive，如 button、sidebar、empty | `shared/components/ui/`，保持扁平及原文件名 | 视为 vendored 代码；本地修改留注释说明，更新前比较差异并保留定制 |
| block 或组合件，如 app-sidebar、nav-user | 全应用一份进 `app/layout/`，单页专用进该页 `-components/` | 作为项目代码维护，不因 CLI 初始落点而留在 ui |
| 业务组件 | 单页本地；跨页按前端结构进入 feature | 不把业务 API 或领域类型放进 shared UI |

调整目录必须同步 `apps/web/components.json` 的 aliases，避免 CLI 再造默认 `src/components/ui/`。`shared/hooks/use-mobile.ts` 也属于 registry 引入的代码，跟随 hooks alias。

## 新增与更新

先查看已安装的组件及其调用方，再决定是否需要 CLI。命令在 `apps/web` 执行，使用 Bun/bunx；需要查新 API 或更新上游时，先查看 CLI 当前版本与帮助，再按 [shadcn skill](../.agents/skills/shadcn/SKILL.md) 的按需参考操作。

未指定外部 registry 时沿用项目现有配置与官方 shadcn registry。新增外部 registry 会引入另一份来源与代码，先核对任务是否需要；普通组件接线无需为 registry 或 preset 额外创建决策环节。

更新已有组件先预览受影响文件和差异，再保留本地改动合入；不要用一次全量覆盖替代差异审阅。授权与覆盖范围按用户当前请求判断，不重复索要已有授权，也不把普通页面任务扩展为全站换肤。
