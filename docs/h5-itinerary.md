---
status: current
summary: H5 分享访问、行程页面、错误展示和移动端视觉规范
read_when:
  - 修改 H5 页面、手机号入口、分享链接或访问校验
  - 修改 H5 样式、弹层、字体适配、测试或错误展示
---

# H5 嘉宾行程：当前实现与开发范式

当前页面位于 `routes/a/$shareToken/`，由分享标识进入，数据通过服务端 H5 接口读取。`/itinerary` 静态原型是早期实现，已不作为当前运行入口。

## 当前访问方式

管理端与 H5 身份独立。H5 的公开入口 `/api/h5Access/submitPhone` 校验分享标识和活动中的手机号关系，并写入 `h5_guest` HttpOnly cookie；`/api/h5` 整个前缀由 `requireH5Member` 解析分享活动与人员。实现见 [auth.ts](../apps/server/src/modules/h5/auth.ts) 和 [入口路由](../apps/server/src/modules/h5/routes.access.ts)。

这是以手机号本身为凭证的简化访问方案，尚无短信验证码、微信授权或独立签发的身份 token；知道号码的人仍可能访问对应行程。记录已有能力不代表提高了身份验证强度。历史重号按当前活动关系的固定顺序取第一条，变更识别规则需单独明确产品口径。

新增 H5 受保护接口沿用该前缀守卫，不使用管理端 `requireUser`，不把两个视角混进一个 handler。cookie 名与 Better Auth 分开（cookie 不按端口隔离）。

## 视觉与结构范式

`apps/h5` 不用 shadcn，与管理端不共享主题和组件。Base UI 提供交互原语，H5 自己维护外观；不加载 Web 字体，使用系统字体栈。表面组件较薄，使用 cn() 和样式常量，不引入管理端的 variants 体系。这个页面确立的写法：

- **弹层交互直接用 `@base-ui/react` 原语自己套样式**（Drawer / Collapsible / Toast）。
  值钱的是焦点管理、滚动锁定和 `aria-*`，不是别人的皮。
- **内联 SVG 图标，不装图标库。**
- **动画走 `styles.css` 的 `--animate-*`**，不引 framer-motion。
- **只有主题红一种强调色。** 交通方式不再分色（`--color-transit` 已废），提示块是
  中性灰底 + 红图标。**别再往里加第二套语义色**——两套语义色并存之后，"这个黄色
  代表什么"就再也没有统一答案了。
- 字阶一律写 rem（h5 走根字号等比缩放，见
  [architecture-decisions.md](architecture-decisions.md#appsh5-的移动端适配根字号等比缩放)）。

### 底部面板的下溢出（2026-09-10）

**`position: fixed; inset: 0` 在 iOS 26 上盖不满可见区域**：定位块停在浏览器控件条
/ 底部安全区之上，页面却照样画到屏幕最底下。表现就是底部面板打开后，屏幕最下方留
一条没被蒙层压暗、还能看见页面内容的缝——只在 iOS 26 上出，所以看着像「部分机型」。
Safari 26.1 起修了，但线上还有大量 26.0 的机器。

**这不是 Base UI 的锅，它只管行为不管定位**——蒙层和面板的 `fixed inset-0` 是我们
自己写的皮。Base UI 官方示例里每个 `Drawer.Backdrop` 都挂着一句
`@supports (-webkit-touch-callout: none) { position: absolute }`，我们照抄样式时漏
了那一句。

修法**没有跟官方那句走**：`position: absolute` 的包含块是初始包含块（Portal 挂在
`body` 末尾、`body` 没定位），页面滚动过之后蒙层会停在文档顶部、整块失效；而 Base UI
在 iOS 上的滚动锁定只是给滚动容器加 `overflow: hidden`，并不把页面拉回顶部。改成两
边一起**往视口下方多铺 33vh**：

- 蒙层 `fixed inset-x-0 top-0 -bottom-[33vh]`（原来是 `inset-0 min-h-dvh`）；
- 面板的 `::after` 垫片 `after:h-[33vh]`（原来是 `after:h-12`，只有 3rem，盖不住
  控件条加安全区的差额）。

fixed 元素不参与视口的可滚动溢出，多铺出去的部分在正常机型上完全看不见。33vh 是
「比任何浏览器控件条 + 安全区都宽裕、又不至于夸张」的量；缝到底多宽取决于机型和
浏览器版本，**别改成某个精确的 px 值去凑**。

代价是面板内容会比屏幕底边高出那一截（背景补满，内容不动），这和 Base UI 官方示例
的 `--bleed` 是同一种取舍。

两个面板组件（`overlay-sheet.tsx`、`navigation-picker.tsx`）各写一份同样的 class，
**改一个记得改另一个**。

## 行程展示口径（2026-09-07）

对齐产品 Demo 与时长口径：

- 用车统一归入「我的行程」；
- 缺发车时间的放「待定安排」，**计入总项数、不算天数**；
- 车程用结束减开始时间（分钟）算，**任一缺失则整个不显示**——禁止占位值。
- 跨天议程按 `Asia/Shanghai` 的自然日拆开展示：首日显示到 `24:00`，后续日期
  从 `00:00` 开始；接口仍保留完整时间段，顶部总项数按原始环节计一次。
- 日卡从第一天有议程的日期开始按日历顺序编号；议程日期范围内只有交通的空档日
  也显示为对应的「第 N 天」，不显示「自由活动」。议程前后的交通日仍显示为「出发日」
  /「返程日」，避免和活动议程日混淆。

## 开发环境怎么进这一页

运行 `bun run dev`，使用启动输出的实际 H5 origin，访问 `/a/demo-itinerary`；种子手机号 `13810000000`（王芳）。不要写死 3101 或猜管理端端口。

`activity.itinerary_share_token` 平时是 null——运营在管理端点过「分享行程链接」
才生成（`project/routes.ts` 的 `getOrCreateItineraryShareToken`）。种子给演示活动
写死了一个（`dev-seed/context.ts` 的 `DEMO.itineraryShareToken`），**其余三场仍留
null**，那条"查不到就 404"的分支才有得调。

想试同号多人那条分支（`auth.ts` 里"后登记的那位永远看到前一位的行程"）用
`13810000003`。

## 座位图（2026-09-08）

议程行上有座位号时多一颗「座位图」按钮，推上来一张**定位图**：这片区的座位分布
 + 我在哪。它自己一套设计取舍——坐标为什么在服务端解析、盒子高度怎么适应从 3.2:1
到 ∞ 的长宽比、一万座为什么只有一个 DOM 节点、为什么不画舞台方位——见
[h5-seat-map.md](h5-seat-map.md)。**改那张图之前先读它**，尤其是"图上所有座位
长得一模一样"这条：一条 path 装下全部座位的前提就是它。

## 运行、测试与错误展示

H5 是浏览器 SPA；路由 loader、beforeLoad 与组件都在浏览器运行，详见 [代码结构](code-structure.md#运行与渲染模型)。默认 404 和错误展示已由 `app/router.tsx` 的 PageMessage 配置；不再沿用原型常量 key-gate 的访问判断。

已有 `bun test` 脚本，例如座位布局逻辑测试；这不等于具有管理端同款的完整组件测试装置。行为改动仍需按范围做浏览器验证。

## 主题与等比缩放

H5 保持亮色，不添加主题切换或系统深色规则；暗色变体绑定到不启用的 .dark。两端 token 分开维护。根字号 clamp 驱动 rem 等比缩放，新字阶与随布局缩放的尺寸写 rem；描边、安全区等物理量可保留 px。算法与取舍见 [ADR](architecture-decisions.md#appsh5-的移动端适配根字号等比缩放)。
