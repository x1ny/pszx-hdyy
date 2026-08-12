# CRUD 页面实现参考

这份文档是"怎么做"，不是"为什么"——原理和取舍见 [architecture-decisions.md](architecture-decisions.md)，仓库级别的硬规则见 [AGENTS.md](../AGENTS.md)。这里只做一件事：把 supplier 模块（供应商管理）踩过的坑和定下的模式抽出来，让下一个 CRUD 模块能直接照抄，不用重新踩一遍。

**范式实现在这两处，写代码时开着对照：**

- 后端：[`apps/server/src/modules/supplier/`](../apps/server/src/modules/supplier/)
- 前端：[`apps/web/src/routes/_authenticated/supplier/`](../apps/web/src/routes/_authenticated/supplier/)

## 目录骨架

新模块叫 `foo`，照这个结构建文件（都是从 supplier 直接改名）：

```
apps/server/src/modules/foo/
├── schema.ts       表定义 + 领域枚举（列里能出现什么）
├── validation.ts   zod 入参契约，从 schema 的枚举拼
└── routes.ts       动作接口 + 显式字段投影

apps/web/src/routes/_authenticated/foo/
├── index.tsx              筛选（URL search params）+ 表格 + 分页
├── -queries.ts             queryOptions / 变更函数 / 领域类型（从接口反推）
├── -utils.ts               中文标签映射、格式化、配色
└── -components/
    ├── foo-form-dialog.tsx     新增/修改弹窗
    └── foo-detail-sheet.tsx    详情侧栏
```

在 `apps/server/src/index.ts` 里 `.route("/", fooRoutes)` 接上链条；在 `apps/web/src/app/nav.ts` 里加菜单项；跑 `bun run --filter '@repo/web' generate-routes` 生成路由类型。

## 后端

### schema.ts

```ts
export const FOO_STATUSES = ["enabled", "disabled"] as const;
export type FooStatus = (typeof FOO_STATUSES)[number];

export const foo = pgTable("foo", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  // ……业务字段
  status: text("status").$type<FooStatus>().notNull().default("enabled"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
    .$onUpdate(() => new Date()).notNull(),
});
```

定下的规矩：

- **主键**：`bigint` + `generatedByDefaultAsIdentity()`（不是 `alwaysAsIdentity`）——`byDefault` 才能在导旧数据时带着原始 id 插入。
- **时间戳**：一律 `{ withTimezone: true }`。不带时区的话 node-postgres 按**服务器进程本地时区**解析，部署机一换时区历史数据就整体平移。
- **软删除默认不加。** 如果表上已经有个 `status` 字段区分启用/停用，再加一个 `deletedAt`/`delFlag` 就是同一张表两套"删除"语义，必然长歪。**只有当别的表开始外键引用这张表的主键时**才补软删——那时候物理删除会留下悬空引用，是真实理由，不是"以防万一"。
- **审计列只留 id，不留姓名。** `createdBy`/`updatedBy` 存 `user.id`，不要冗余 `createUserName` 这种列——姓名一改就跟 user 表对不上。除非页面明确要展示"谁创建的"却不想联表查，否则连 id 都不用加；id 加不加看你有没有事后回填的机会（事后加列容易，事后回填创建人几乎不可能）。
- **索引不预先加。** 新表体量小的时候顺序扫描比索引快，规划器也不一定会用刚建的索引。等实测出慢查询再加——加索引是一行迁移，删掉一个没人敢动的索引才麻烦。

### validation.ts

```ts
export const ListFooInput = PageInput.extend({
  name: filter,              // 见下面的 filter 帮助函数
  status: FooStatusEnum.optional(),
});
export const CreateFooInput = FooInput;
export const UpdateFooInput = FooInput.extend({ id });
export const FooIdInput = z.object({ id });
export const SetFooStatusInput = z.object({ id, status: FooStatusEnum });
```

- 列表入参统一 `PageInput.extend({ ...筛选字段 })`（`shared/pagination.ts`），出参统一 `{ list, total }`，不要各模块自己定 `pageNo`/`current` 这种同义词。
- **筛选字段**：空串要收敛成 `undefined`，否则空字符串会被当成"筛这个值"传到 SQL 里。抄 supplier 的 `filter` helper：`z.string().trim().optional().transform(v => v || undefined)`。
- **枚举必须带中文 `error`**：`z.enum(XXX, { error: "……不正确" })`。不带的话校验失败时前端 toast 出来的是 zod 默认英文文案（`Invalid option: expected one of …`），这是真实踩过的坑。
- **状态切换接口传目标值，不要传"取反"**：`setFooStatus({ id, status })` 而不是 `toggleFooStatus(id)`。toggle 不幂等——两个人同时点、或者一次网络重试，结果就不可预测。

### routes.ts

```ts
export const fooRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)
  .post("/api/listFoo", jsonBody(ListFooInput), async (c) => { /* … */ })
  .post("/api/getFoo", jsonBody(FooIdInput), async (c) => { /* … */ })
  .post("/api/createFoo", jsonBody(CreateFooInput), async (c) => { /* … */ })
  .post("/api/updateFoo", jsonBody(UpdateFooInput), async (c) => { /* … */ })
  .post("/api/setFooStatus", jsonBody(SetFooStatusInput), async (c) => { /* … */ })
  .post("/api/deleteFoo", jsonBody(FooIdInput), async (c) => { /* … */ })
  .post("/api/getFooStats", async (c) => { /* … */ });
```

规矩，每条都在这次实现里真实踩过：

- **⚠️ 最容易踩的坑：不要给 `ok()`/`err()` 补返回类型标注。** `shared/result.ts` 里这两个函数故意让 TS 自然推导。补上 `: ApiResult<T>` 看着更"规范"，代价是每个接口的响应类型变成「OK ∪ 全部错误码」，`hc` 推出来的类型精度就没了——前端 `Extract<响应, {code:"OK"}>` 取不回精确的 `data`，只能手抄一份领域类型然后慢慢跟服务端漂移。这个坑第一次写 supplier 时真的踩了一遍（`Supplier` 类型被推成 `never`），排查了好一阵才定位到根因。
- **列表接口显式列出返回字段**（写一个 `fooFields` 常量传给 `.select()`），不要 `select().from(foo)` 整行吐出去。这样表上新加一列不会顺带改动 API 契约，也不会把 `createdBy` 这种内部字段发到浏览器。
- **`updateFoo` 直接 `UPDATE ... RETURNING`，不要先 `SELECT` 再判断存在再 `UPDATE`。** 那是两次往返 + 一个竞态窗口。`returning()` 拿到空数组就是"这行不存在"，一次查询搞定。
- **排序按 `id DESC`，不要按 `updatedAt DESC`。** 这是这次被用户当场抓到的真实 bug：按更新时间排的话，编辑或者切换状态会把那一行弹到列表第一位——用户点第三行的"停用"，那一行立刻跳到第一行，视线和鼠标都要重新找。`id` 是不会因为编辑而变化的排序键，行会稳定待在原地。翻页也需要它：`id` 唯一不需要兜底排序键，`updatedAt` 可能撞毫秒导致翻页时出现重复行或跳过行。
- **需要登录的模块整条链头上挂一次 `requireUser`**（`modules/auth/require-user.ts`），handler 里用 `c.get("authedUser")`（非空），不要每个 handler 各写一遍 `c.get("user")` 判空。
- **概览统计单独开一个 `getXxxStats` 接口，且不带筛选条件。** 如果统计数字跟着筛选变，用户每改一次筛选顶部数字就跳一次，反而没法当参照系。用 SQL 的 `count(*) filter (where …)` 把多个计数塞进一条查询，别对每个数字单独发一次请求。

## 前端

### 领域类型不手抄，从接口反推

```ts
export type Foo = ApiData<InferResponseType<typeof api.api.getFoo.$post>>;
export type FooFilters = InferRequestType<typeof api.api.listFoo.$post>["json"];
```

`shared/lib/api.ts` 的 `unwrap()` 统一拆 `ApiResult` 信封，失败走 `throw new ApiError(code, message)`，交给 react-query 的 `isError`/`onError` 处理——不要在每个 `queryFn` 里手写一遍 `if (result.code !== "OK") throw ...`。

### 筛选条件放 URL，不放 `useState`

```ts
const FooSearchSchema = z.object({
  name: z.string().optional().catch(undefined),
  status: z.enum(FOO_STATUS_VALUES).optional().catch(undefined),
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(10).catch(10),
});

export const Route = createFileRoute("/_authenticated/foo/")({
  validateSearch: FooSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(fooListQueryOptions(deps)),
  component: FooPage,
});
```

- zod v4 直接当 `validateSearch` 用，不需要 `@tanstack/zod-adapter`。
- **每个字段都要 `.catch(...)`**：别人手改 URL 传乱七八糟的值时，页面要降级成"全部/第一页"而不是崩掉。
- 链接可分享、可收藏，浏览器后退能回到上一组筛选条件——这是不用 `useState` 的真实理由，不是装饰性的架构洁癖。
- 名称这类自由输入框例外：本地 `useState` 暂存，回车或点"筛选"才写进 URL。每敲一个字母都 push 一条 history 的话，后退键就废了。
- **改任何筛选条件都要把 `page` 重置成 1。** 停留在第 5 页、筛选结果只有 2 页数据的话，页面会看起来"筛没了"。

### 表单用 TanStack Form，不用 react-hook-form

这个决定是在写 supplier 表单时现场翻出来的：本项目的 shadcn registry 是 `base-vega`，**没有 `form.tsx`**（只有 `field.tsx`），RHF 在 shadcn 里最大的集成优势拿不到；而且全部输入组件是 Base UI **受控**组件，用 RHF 每个 `Select` 都得包一层 `Controller`。TanStack Form 受控优先，且原生吃 Standard Schema（zod 4 直接当 validator，不需要 `@hookform/resolvers`），校验出来的 `StandardSchemaV1Issue[]` 正好喂给 `ui/field.tsx` 的 `<FieldError errors={…} />`。

```tsx
const form = useForm({
  defaultValues,
  validators: { onChange: FooFormSchema, onSubmit: FooFormSchema },
  onSubmit: ({ value }) => onSubmit(value),
});

<form.Field name="name">
  {(field) => (
    <Field>
      <FieldLabel htmlFor={field.name}>
        名称
        <RequiredMark />
      </FieldLabel>
      <Input
        id={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
      />
      {/* 错误必须挂在 isTouched 后面，见下面「⚠️ 满屏飘红」那条 */}
      <FieldError errors={field.state.meta.isTouched ? field.state.meta.errors : []} />
    </Field>
  )}
</form.Field>
```

- **⚠️ 又一个第一次写就踩的坑：`errors` 一定要挂在 `field.state.meta.isTouched` 后面，不能直接 `field.state.meta.errors`。** `validators.onChange` 校验的是**整个 schema**，不是只校验被改动的那个字段——用户刚打开表单敲第一个字，TanStack Form 会把全表单的校验结果按路径分发给每一个 `field`，所有还没填的必填项会**立刻**一起飘红，而不是等用户碰到那个字段才提示。这是真实发生过的 bug：新增弹窗里输入框刚打第一个字，其余五个字段瞬间全部变红。修法是渲染错误时用 `field.state.meta.isTouched ? field.state.meta.errors : []` 兜一层——`isTouched` 在这个字段 `blur` 过、或者点了"保存"触发全字段校验时才会是 `true`（TanStack Form 在 `handleSubmit` 里会先把所有字段标成 touched 再校验，所以提交时该报的错还是会全报，不受这层判断影响）。`aria-invalid` 同理也要加这层判断。
- **必填星号用 `<RequiredMark />` 单独上色**（`text-destructive`），不要把 `*` 直接拼进标签字符串——纯文本里的 `*` 会跟着标签一起变成普通黑字。
- 多选用 Base UI 的 `<Select multiple items={LABELS} value={...} onValueChange={...}>` 原生支持，不用另外拼 Popover+Command 组合件——选项数量不多、不需要搜索框的场景，多一层组合件只是多一处要维护的键盘交互。**但 `Select` 关闭时不会触发原生 `blur` 事件**，`onValueChange` 里要顺手调一次 `field.handleBlur()`，否则选完选项之后错误提示要等用户点别处才会消失（`isTouched` 一直是 `false`，反而会导致选完了必填项、`FieldError` 却还压着上一次判空的错误没消失——这个不是"多显示"的问题，是"该消失时不消失"）。

**表单校验 schema 是服务端那份的镜像，故意手抄一份，不是 bug。** `apps/web` 对 `@repo/server` 只能 `import type`，从根 import 会把服务端依赖（`pg` 等）拽进浏览器包。现在只有一个模块，两份对照着看得过来；等第三个模块也在抄同一批规则时，才值得开 `packages/contracts`（纯 zod + 类型，零运行时依赖）——现在开就是在只有一个消费方时建包，本仓库明确否掉的模式。服务端**始终**是权威校验方，前端这份只是让用户在点提交前就看到错误。

**`key={record?.id ?? "new"}` 让表单整体重新挂载**，而不是在 `useEffect` 里手动 `reset`。切换编辑对象时不会出现"上一条的校验错误残留在这一条"。

### 列表页布局

从上到下：统计磁贴（可选，数据量大或者有明显状态分布时加）→ 筛选栏 → 表格 → 分页。

```tsx
const listQuery = useQuery(fooListQueryOptions(search));
const saveMutation = useMutation({
  mutationFn: (values) => editing ? updateFoo({ ...values, id: editing.id }) : createFoo(values),
  onSuccess: () => {
    toast.success(editing ? "修改成功" : "新增成功");
    setFormOpen(false);
    queryClient.invalidateQueries({ queryKey: fooKeys.all });
  },
  onError: (error) => toast.error(error.message),
});
```

- 变更成功后 `invalidateQueries({ queryKey: xxxKeys.all })` 一把带走列表、详情、统计——不要手写一遍 `fetchList()` + `loadOptions()` 之类的命令式刷新。
- **只禁用正在提交的那一行**：`disabled={mutation.isPending && mutation.variables?.id === row.id}`，不要写成 `disabled={mutation.isPending}`——后者会让整列按钮一起变灰，看着像整个表格卡住了。
- 删掉当前页最后一条时，`page` 要退一页，不然会停在一张空表上。

## 视觉规范

这几条是这次被用户当场纠正/确认下来的，直接照搬，不要重新发明：

### 分类色板已经修好了，直接用

`apps/web/src/styles.css` 的 `--chart-1..5` 是过了色觉障碍校验的真彩色（不是 shadcn neutral 主题原装的灰阶）。业务里但凡有"多个平级分类"要用颜色区分（供应商服务类目、以后可能出现的标签/优先级），走 `chart-1..5` 五个槽位**固定轮转分配**，不要哈希、不要每次渲染算一次：

```ts
export const CATEGORY_BADGE_CLASS = {
  a: "border-transparent bg-chart-1/10 text-chart-1",
  b: "border-transparent bg-chart-2/10 text-chart-2",
  // ……按 SERVICE_CATEGORY_VALUES 声明顺序轮转，超过 5 个就回到 chart-1
} as const satisfies Record<Category, string>;
```

`satisfies Record<枚举, string>` 是硬性要求——加一个分类不补颜色，编译不过，不会出现"新类目没有颜色"的漏网之鱼。

`--success`/`--warning` 是**保留的状态色**，专门给"启用/停用"这类状态用，**不参与**上面的分类轮转——一个颜色要么表示"哪一类"要么表示"什么状态"，两用了用户没法从颜色反推含义。状态芯片配色抄 `SUPPLIER_STATUS_CHIP`/`SUPPLIER_STATUS_DOT` 这两个 Record。

### Button：ghost 变体要手动上色，不能是默认黑

`ghost` 变体本身不设文字色，继承的是 `--foreground`（近黑）。表格行内操作这类"需要看起来能点、但不需要 `default` 变体那种实心背景"的按钮，统一：

- 正常操作（详情/修改/启用停用）：`variant="ghost" className="text-primary hover:text-primary"`
- 危险操作（删除）：`variant="ghost" className="text-destructive hover:text-destructive"`
- 次要操作（重置筛选）：`variant="ghost" className="text-muted-foreground hover:text-foreground"`

`link` 变体（`text-primary`，已去掉默认下划线）目前没在用，但留着——纯文字链接场景直接用它，不用再手写颜色。

### 表格：内边距、表头、操作列对齐

`shared/components/ui/table.tsx` 已经改过（相对 shadcn 原版，有注释说明），新表格直接受益，不用重复处理：

- `TableCell`/`TableHead` 是 `px-4 py-3`，不是 shadcn 原版的 `p-2`——8px 内边距在多列宽表格里会让首末两列贴着表格外边框。
- `TableHead` 默认 `text-xs text-muted-foreground font-semibold`，跟 `TableCell` 的正文拉开字号和颜色反差。中文没有大小写，做区分不能靠 `uppercase`，只能靠这两点。
- 操作列**居中，不要右对齐**：`<TableHead className="text-center">操作</TableHead>`，配 `<TableCell className="text-center">` 里包一个 `<div className="inline-flex items-center gap-1">`。右对齐会因为"启用"/"停用"文字长度不一致，导致按钮组左边界逐行晃动，看起来跟表头对不齐；居中对齐时两端留白始终对称。按钮组的间距交给这层 `inline-flex gap-1` 统一控制，不要依赖每个按钮自身 padding 碰运气拼出来的空隙。

### 全局：cursor-pointer 别漏

Tailwind v4 的 preflight 去掉了 `button { cursor: pointer }`（改成对齐原生 `<button>` 默认行为，即 `cursor: default`）。`shared/components/ui/button.tsx` 和 `select.tsx` 的 `SelectTrigger` 已经手动补回 `cursor-pointer`（vendored 组件，带注释）。**新增任何可点击的 vendored 组件（比如以后装 `checkbox`、`switch`），装完先摸一遍鼠标手势，Tailwind v4 默认不会给。**

## 新建一个 CRUD 模块的检查清单

1. 后端：`schema.ts`（主键/时间戳/审计列按上面的规矩，先别加索引和软删）
2. 后端：`validation.ts`（`PageInput.extend`、筛选字段走 `filter` helper、枚举带中文 `error`）
3. 后端：`routes.ts`（`requireUser` 挂链头、显式字段投影、`updateFoo` 用 `RETURNING`、按 `id DESC` 排序、单独一个不带筛选的 `getXxxStats`）—— **`ok()`/`err()` 千万别加类型标注**
4. `index.ts` 里 `.route("/", fooRoutes)`
5. `bun run db:push`
6. 前端：`-queries.ts`（类型全部 `InferResponseType`/`InferRequestType` 反推，不手抄）
7. 前端：`-utils.ts`（中文标签、`CATEGORY_BADGE_CLASS` 这类配色 Record 都要 `satisfies`）
8. 前端：`index.tsx`（URL 驱动筛选、`.catch()` 兜底、`loaderDeps`+`ensureQueryData` 预取、操作列居中）
9. 前端：`-components/xxx-form-dialog.tsx`（TanStack Form + 手抄镜像 schema + `key` 强制重挂载）
10. 前端：`-components/xxx-detail-sheet.tsx`
11. `app/nav.ts` 加菜单项 + `bun run --filter '@repo/web' generate-routes`
12. `bun run typecheck`，然后开浏览器实测一遍：**新增弹窗打第一个字，确认只有那一个字段有反应，不是满屏飘红**、多选、翻页、状态切换后行不跳动、删除确认、URL 乱传参数不崩
