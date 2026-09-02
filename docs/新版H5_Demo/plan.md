# 行程分享 H5 — 第二轮迭代计划（UI 精致化 + 底部栏修复）

## 用户反馈
1. UI 不够精致、缺少艺术氛围
2. 底部功能按钮（添加到日历 / 转发给同行人）错落、向右偏移、被视口裁切

## 根因定位
- `StickyShareBar.tsx` 的 `motion.div` 同时使用 Tailwind `left-1/2 -translate-x-1/2` 与
  Framer Motion `y` 动画；FM 写入的内联 `transform` 覆盖了 Tailwind translate，
  导致底部栏从视口 50% 处开始向右布局 → 右裁切、按钮错落。

## 阶段

### Stage 1 — 底部栏结构性修复（主 agent 直接改）
- 分支：`fix-ui-polish`（从 master fork）
- 外层 `fixed inset-x-0 bottom-0 flex justify-center` 负责居中，内层 motion.div 只做 y 动画
- 同时提升底部栏质感：更细腻的按钮层次、安全区、分隔线

### Stage 2 — 视觉精致化（保持 2 屏约束）
- 首屏头图：叠加泉州东西塔/闽南建筑几何线稿 SVG + 渐变罩层，提升艺术层次
- 卡片：更细腻的阴影分层、发丝边框、圆角节奏
- 交通卡：票根感（打孔虚线分隔）、等宽数字强化
- 议程时间轴：更优雅的节点与连线
- 细节：字距、标签、微动效
- 约束：默认高度仍 ≤ 2 屏（375×667 实测 ≤ 1334px）

### Stage 3 — 验证与交付
- `npm run build` 通过
- Playwright 375×667 验证：底部栏居中、高度 ≤ 2 屏、地图浮层正常
- 合并回 master，`build_version` 保存新版本
