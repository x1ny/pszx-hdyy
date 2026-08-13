# 活动运营平台 HTML 原型

## 查看方式

直接打开 `prototype/index.html` 即可查看原型导航；无需构建工具和后端服务。

## 当前阶段

后台 Web 端与移动公众端 H5 核心链路页面已形成可本地打开的静态原型。

## 后台菜单结构

后台左侧菜单已按真实系统信息架构调整为“一级业务模块 -> 二级功能入口”。项目详情、活动详情、活动配置、排位画布属于上下文页面，不作为一级菜单展示。

一级菜单包括：

- 工作台
- 项目管理
- 人员管理
- 邀请函管理
- 排位管理
- 供应商管理
- 系统管理

## 已完成页面

- `index.html`：原型导航首页
- `admin/dashboard.html`：后台首页
- `admin/project-list.html`：项目列表
- `admin/project-detail.html`：项目详情
- `admin/project-members.html`：项目人员管理
- `admin/activity-list.html`：项目下活动列表
- `admin/activity-detail.html`：活动详情，上下文页面，不作为一级菜单
- `admin/activity-config.html`：活动配置中心
- `admin/agenda-timeline.html`：议程/环节统一入口，含时间轴画布和环节列表
- `admin/session-config.html`：旧路径兼容提示页，不作为维护入口
- `admin/activity-space.html`：场地空间配置
- `admin/resource-summary.html`：资源需求汇总
- `admin/resource-ledger.html`：活动资源台账
- `admin/member-master.html`：全量人员库
- `admin/activity-members.html`：活动人员
- `admin/registration-review.html`：报名管理与审核
- `admin/invitation-templates.html`：邀请函模板
- `admin/invitation-generate.html`：生成邀请函
- `admin/invitation-records.html`：邀请函生成记录
- `admin/venue-library.html`：场地库
- `admin/venue-workbench.html`：场地画布工作台
- `admin/seating-list.html`：排位方案列表
- `admin/seating-canvas.html`：排位画布
- `admin/seating-confirm.html`：排位确认
- `admin/message-templates.html`：消息规则
- `admin/message-records.html`：消息发送记录
- `admin/supplier-list.html`：供应商列表
- `admin/supplier-quotes.html`：供应商历史报价附件
- `admin/system-permissions.html`：用户角色权限

## 移动公众端 H5

H5 顶层拆为两个主文件：

1. `h5/entry.html`：项目活动报名入口，免登录查看平台已上架项目，支持按项目名称、地点查询；进入项目详情后查看项目介绍和项目下活动列表。
2. `h5/my-activities.html`：我的活动，登录后查看当前人员自己的当前进行中活动，支持活动切换，并提供历史活动列表入口；页面内“我的”区包含个人信息维护、消息通知、收到的邀请函列表。

- `h5/entry.html`：项目活动报名入口，免登录查看和报名
- `h5/login.html`：手机号验证
- `h5/identity-select.html`：同手机号多人身份选择
- `h5/my-activities.html`：我的活动主页面
- `h5/home.html`：兼容旧入口，展示同“我的活动”
- `h5/my-history.html`：历史参与活动列表
- `h5/project-list.html`：项目活动报名入口兼容路径
- `h5/project-detail.html`：项目详情
- `h5/activity-list.html`：项目下活动列表
- `h5/activity-detail.html`：活动详情和活动内服务入口
- `h5/registration.html`：活动报名
- `h5/registration-result.html`：报名结果
- `h5/profile.html`：个人信息维护
- `h5/agenda.html`：议程/环节
- `h5/trip.html`：到离行程与本人服务安排
- `h5/seat-detail.html`：按环节展示本人座位
- `h5/invitation.html`：H5 邀请函展示
- `h5/messages.html`：消息列表
- `h5/message-detail.html`：消息详情

## 演示账号和角色

原型不接真实账号，后台首页提供角色切换：

- 管理人员
- 业务负责人
- 运营人员

切换为运营人员后，部分删除、确认、高风险按钮会禁用，用于表现权限边界。

## 推荐演示路径

1. `index.html` -> `admin/dashboard.html`
2. `admin/project-list.html` -> `admin/project-detail.html`
3. `admin/activity-list.html` -> `admin/activity-detail.html` -> `admin/activity-config.html`
4. `admin/agenda-timeline.html` 时间轴画布/环节列表 -> `admin/resource-summary.html`
5. `admin/resource-summary.html` -> `admin/resource-ledger.html` 查看活动级资源和人员服务绑定
6. `admin/invitation-templates.html` -> `admin/invitation-generate.html` -> `admin/invitation-records.html` 手动单发或批量发送邀请函提醒
7. `admin/venue-library.html` -> `admin/venue-workbench.html` -> `admin/activity-space.html` -> `admin/seating-list.html` -> `admin/seating-canvas.html` -> `admin/seating-confirm.html`
8. `admin/message-templates.html` -> `admin/message-records.html` 查看站内信/短信发送记录
9. `h5/entry.html` -> 查询项目活动 -> 查看活动详情 -> 填写报名 -> 报名结果
10. `h5/login.html` -> 输入手机号 `13800001234` 和验证码 `123456` -> 选择人员身份 -> `h5/my-activities.html`
11. `h5/my-activities.html` -> 切换当前进行中活动、查看历史活动列表、进入个人信息、消息通知、收到的邀请函

## 当前模拟数据

模拟数据集中维护在 `assets/js/mock-data.js`，覆盖项目、活动、环节、人员、活动资源、邀请函、排位方案和消息记录。

## 已实现交互

- 页面真实相对路径跳转
- 项目、活动、人员、资源、邀请函、排位、消息数据渲染
- H5 免登录报名入口、活动查询、报名提交模拟
- H5 我的活动登录、同手机号多人选择、当前进行中活动切换、历史活动入口、个人信息维护
- H5 活动详情、议程、行程、座位、邀请函、消息跳转
- 角色切换和部分按钮权限禁用
- 弹窗打开/关闭
- Toast 反馈
- 邀请函手动提醒和批量提醒确认
- 资源人员绑定确认
- 排位保存待确认和确认提示

## 后续替换项

- 短信供应商、签名、模板审核、回执方式需真实联调时替换
- 附件预览格式按开发实际能力确认
- 普通角色真实账号需联调环境验证
- H5 当前为静态模拟联动，真实接口对接时需替换登录、报名提交、消息已读、邀请函下载、个人信息保存等接口
