/**
 * 生成全部业务接口的人读清单，产物有两个：
 * `apps/web/public/docs/api.html`（在线看）和同目录的 `api.md`（下载）。
 *
 * 运行：`bun run docs:api`；`bun run build` 会先跑一遍，所以线上那份天然跟
 * 镜像同版本。产物目录不进 git —— 每次构建都重新生成，提交一份等于凭空多一个
 * 会过期的副本。
 *
 * ## 它为什么可信
 *
 * 路由表和入参**都是从运行时读出来的**：脚本 import 真正的 Hono 实例，遍历
 * `app.routes` 拿到每条注册路由，再用 `shared/validate.ts` 的 `validatedInputs`
 * 反查这条路由挂了哪个 zod schema。加接口、删接口、改前缀、改字段，重新跑一次
 * 就全对上——不存在"文档另抄一份、抄的和跑的慢慢漂移"这个窗口。
 *
 * 只有两样东西运行时拿不到，是静态扫源码补的：**接口上方的 JSDoc 说明**和
 * **源码行号**。这两样扫不到就是空着（表格里少一行说明），不会写错。
 *
 * ## 它明确不覆盖什么
 *
 * **出参形状。** 项目刻意不给 `ok()` / `err()` 标注返回类型（理由见
 * `shared/result.ts` 的注释：标了就取不回精确的 `data`），所以服务端没有任何
 * 可供读取的出参声明。这里只写统一信封和分页约定，具体 `data` 的字段请看
 * `routes.ts` 里显式的字段投影，或者前端直接用 `hc<AppType>` 拿类型——那才是
 * 出参的权威来源。硬在文档里再抄一份出参，就正好制造了上面想避免的漂移。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Glob } from "bun";
import { routes as app } from "../apps/server/src/index";
import { requireUser } from "../apps/server/src/modules/auth";
import {
  type ValidatedInput,
  validatedInputs,
} from "../apps/server/src/shared/validate";

const REPO_ROOT = resolve(import.meta.dir, "..");
const SERVER_SRC = resolve(REPO_ROOT, "apps/server/src");
/**
 * Vite 把 `public/` 原样拷进 `dist/`，生产环境的 Hono 又把 `dist/` 当静态根
 * （`WEB_DIST_DIR`，见 `apps/server/src/index.ts`），所以这里写出去的文件在线上
 * 就是 `/docs/api.html` 和 `/docs/api.md`。
 */
const OUTPUT_DIR = resolve(REPO_ROOT, "apps/web/public/docs");

// 纯展示用的模块中文名。少一个键不影响正确性，标题退化成前缀本身而已——
// 所以这里不算"另抄一份契约"，接口清单本身仍然全部来自运行时。
const MODULE_TITLES: Record<string, string> = {
  "/api/example": "示例（范式演示）",
  "/api/supplier": "供应商",
  "/api/supplierQuote": "供应商报价",
  "/api/member": "人员主档",
  "/api/projectMember": "项目人员",
  "/api/activityMember": "活动人员",
  "/api/segmentMember": "环节人员",
  "/api/invitation": "邀请函",
  "/api/file": "文件",
  "/api/project": "项目",
  "/api/activity": "活动",
  "/api/agenda": "议程与环节",
  "/api/resourceDemand": "环节资源需求",
  "/api/activityResource": "活动资源台账",
  "/api/activityConfig": "活动配置完整性",
};

const TARGET_TITLES: Record<string, string> = {
  json: "请求体（JSON）",
  form: "表单字段（multipart/form-data）",
  param: "路径参数",
  query: "查询参数",
};

// ---------------------------------------------------------------------------
// zod 内部结构的只读访问
//
// zod 4 的 `z.toJSONSchema()` 也能出结构，但会丢掉 `.min(1, "项目名称不能为空")`
// 里的那句中文——而那句话恰恰是这份文档里最像"人话"的部分（它顺带告诉读者这个
// 字段在业务上叫什么）。所以这里直接读 `_zod.def`，把结构和文案一起取出来。
// ---------------------------------------------------------------------------

type ZodDef = {
  type: string;
  innerType?: unknown;
  in?: unknown;
  element?: unknown;
  left?: unknown;
  right?: unknown;
  shape?: Record<string, unknown>;
  options?: unknown[];
  entries?: Record<string, unknown>;
  values?: unknown[];
  keyType?: unknown;
  valueType?: unknown;
  defaultValue?: unknown;
  format?: string;
  coerce?: boolean;
  checks?: unknown[];
  error?: unknown;
};

type CheckDef = {
  check: string;
  minimum?: number;
  maximum?: number;
  value?: number;
  inclusive?: boolean;
  format?: string;
  error?: unknown;
  path?: (string | number)[];
};

const defOf = (schema: unknown): ZodDef | undefined =>
  (schema as { _zod?: { def?: ZodDef } } | null | undefined)?._zod?.def;

const checkDefOf = (check: unknown): CheckDef | undefined =>
  (check as { _zod?: { def?: CheckDef } } | null | undefined)?._zod?.def;

/**
 * 把 zod 的 error 取成字符串。它可能是字符串，也可能是个接收 issue 的函数
 * （`z.string().min(1, "…")` 就会包成函数）。函数里若引用了 issue 的字段，
 * 用空对象调会抛——抛了就当没有文案，不影响其余内容。
 */
const messageOf = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (typeof error !== "function") return "";

  try {
    const produced = (error as (issue: unknown) => unknown)({});
    return typeof produced === "string" ? produced : "";
  } catch {
    return "";
  }
};

type Peeled = {
  schema: unknown;
  optional: boolean;
  nullable: boolean;
  defaultValue?: unknown;
};

/**
 * 剥掉包装层，露出真正的基础类型。
 *
 * `pipe` 永远走 `in` 侧：`.optional().transform(v => v || undefined)` 这类写法
 * 会被包成 pipe，而文档描述的是**调用方要传什么**，不是 handler 最终收到什么。
 */
const peel = (schema: unknown): Peeled => {
  let current = schema;
  let optional = false;
  let nullable = false;
  let defaultValue: unknown;

  // 上限纯防御：schema 是静态写死的，不会真的嵌这么深。
  for (let step = 0; step < 20; step += 1) {
    const def = defOf(current);

    if (!def) break;

    if (def.type === "optional") {
      optional = true;
      current = def.innerType;
      continue;
    }

    if (def.type === "nullable") {
      nullable = true;
      current = def.innerType;
      continue;
    }

    if (def.type === "default" || def.type === "prefault") {
      // 有默认值 = 调用方可以不传。
      optional = true;
      defaultValue = def.defaultValue;
      current = def.innerType;
      continue;
    }

    if (def.type === "catch" || def.type === "readonly") {
      current = def.innerType;
      continue;
    }

    if (def.type === "pipe") {
      current = def.in;
      continue;
    }

    break;
  }

  return { schema: current, optional, nullable, defaultValue };
};

const formatValue = (value: unknown): string => {
  if (typeof value === "string") return `"${value}"`;
  if (value === undefined) return "undefined";

  return JSON.stringify(value) ?? String(value);
};

const STRING_FORMAT_NOTES: Record<string, string> = {
  date: "日期字符串，形如 2026-08-20",
  datetime: "ISO 时间字符串",
  time: "时间字符串",
  duration: "ISO 时长字符串",
  email: "邮箱格式",
  url: "URL 格式",
  uuid: "UUID 格式",
  guid: "GUID 格式",
  cuid: "CUID 格式",
  nanoid: "Nanoid 格式",
  regex: "需匹配固定格式",
};

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${Math.round(bytes / 1024 / 1024)} MB`
    : `${bytes} 字节`;

/**
 * 把一个 check 翻译成一句约束描述；返回空串表示这条 check 不值得写进文档。
 *
 * 需要基础类型才能翻对单位：`min_length` 在字符串上是"字"，在数组上是"项"；
 * `max_size` 在文件上量的是字节。zod 内部这几个 check 同名，只有外层类型
 * 能区分。
 */
const noteForCheck = (check: CheckDef, baseType: string): string => {
  const unit = baseType === "array" ? "项" : "字";

  switch (check.check) {
    case "min_length":
      return `最少 ${check.minimum} ${unit}`;
    case "max_length":
      return `最多 ${check.maximum} ${unit}`;
    case "length_equals":
      return `长度须为 ${check.minimum ?? check.maximum} ${unit}`;
    case "greater_than":
      return check.inclusive ? `≥ ${check.value}` : `> ${check.value}`;
    case "less_than":
      return check.inclusive ? `≤ ${check.value}` : `< ${check.value}`;
    case "multiple_of":
      return `须为 ${check.value} 的倍数`;
    case "min_size":
      return baseType === "file"
        ? `至少 ${formatBytes(check.minimum ?? 0)}`
        : `至少 ${check.minimum} 项`;
    case "max_size":
      return baseType === "file"
        ? `至多 ${formatBytes(check.maximum ?? 0)}`
        : `至多 ${check.maximum} 项`;
    case "size_equals":
      return `须为 ${check.minimum ?? check.maximum} 项`;
    case "string_format":
      return STRING_FORMAT_NOTES[check.format ?? ""] ?? "";
    // number_format 决定的是"整数还是小数"，在类型列里说更清楚；
    // overwrite 是 .trim() 之类的规范化，不是调用方要满足的约束；
    // custom 是 .refine()，它的文案由下面的 message 分支单独取。
    default:
      return "";
  }
};

/**
 * 约束和校验文案分成两列：
 * 约束是**机器读出来的边界**（最多 255 字、≥ 0），文案是**用户真会看到的
 * 那句错误提示**。后者常常是这张表里唯一说清"这个字段业务上叫什么"的东西
 * （"总预算不能为负数" 比 `totalBudget: number` 有用得多），但它不是约束，
 * 混在一列里会让人以为规则被重复写了两遍。
 */
type Described = { type: string; constraints: string[]; messages: string[] };

const describe = (peeled: Peeled): Described => {
  const def = defOf(peeled.schema);
  const constraints: string[] = [];
  const messages: string[] = [];

  if (peeled.defaultValue !== undefined) {
    constraints.push(`默认 ${formatValue(peeled.defaultValue)}`);
  }

  if (peeled.nullable) constraints.push("可为 null");

  if (!def) return { type: "未知", constraints, messages };

  const checks = (def.checks ?? [])
    .map(checkDefOf)
    .filter((check): check is CheckDef => check !== undefined);

  let type: string;

  switch (def.type) {
    case "string": {
      type = "字符串";
      const formatNote = STRING_FORMAT_NOTES[def.format ?? ""];
      if (formatNote) constraints.push(formatNote);
      break;
    }
    case "number": {
      const isInteger = checks.some((check) => check.check === "number_format");
      type = isInteger ? "整数" : "数字";
      if (def.coerce) constraints.push("接受数字字符串，自动转换");
      break;
    }
    case "boolean":
      type = "布尔";
      break;
    case "date":
      type = "日期时间";
      if (def.coerce) constraints.push("接受 ISO 时间字符串，自动转换");
      break;
    case "file":
      type = "文件";
      break;
    case "enum": {
      type = "枚举";
      const values = Object.values(def.entries ?? {}).map(formatValue);
      if (values.length > 0) constraints.push(`可选值 ${values.join(" | ")}`);
      break;
    }
    case "literal": {
      const values = (def.values ?? []).map(formatValue);
      type = `字面量 ${values.join(" | ")}`;
      break;
    }
    case "array": {
      // 元素的约束（枚举可选值之类）要跟上来，否则 `枚举[]` 这一格等于什么
      // 都没说。
      const element = describe(peel(def.element));
      type = `${element.type}[]`;
      constraints.push(
        ...element.constraints.map((note) =>
          /^\p{Script=Han}/u.test(note) ? `元素${note}` : `元素 ${note}`,
        ),
      );
      messages.push(...element.messages);
      break;
    }
    case "object":
    case "intersection":
      type = "对象";
      break;
    case "union": {
      const options = (def.options ?? []).map((option) =>
        describe(peel(option)),
      );
      type = options.map((option) => option.type).join(" | ") || "联合";
      for (const option of options) {
        constraints.push(...option.constraints);
        messages.push(...option.messages);
      }
      break;
    }
    case "record": {
      const value = describe(peel(def.valueType));
      type = `映射<字符串, ${value.type}>`;
      break;
    }
    case "any":
    case "unknown":
      type = "任意";
      break;
    default:
      type = def.type;
      break;
  }

  for (const check of checks) {
    const note = noteForCheck(check, def.type);
    if (note) constraints.push(note);
  }

  for (const source of [def.error, ...checks.map((check) => check.error)]) {
    const message = messageOf(source);
    if (message) messages.push(message);
  }

  return {
    type,
    constraints: [...new Set(constraints)],
    messages: [...new Set(messages)],
  };
};

type FieldRow = {
  name: string;
  type: string;
  required: boolean;
  constraint: string;
  message: string;
};

const MAX_NESTING = 4;

const addObjectFields = (
  schema: unknown,
  prefix: string,
  rows: FieldRow[],
  depth: number,
) => {
  const { schema: base } = peel(schema);
  const def = defOf(base);

  if (!def) return;

  // `A.and(B)` 的两边摊进同一张表——调用方看到的就是一个平的对象。
  if (def.type === "intersection") {
    addObjectFields(def.left, prefix, rows, depth);
    addObjectFields(def.right, prefix, rows, depth);
    return;
  }

  if (def.type !== "object") return;

  for (const [key, value] of Object.entries(def.shape ?? {})) {
    const peeled = peel(value);
    const described = describe(peeled);
    const name = prefix ? `${prefix}.${key}` : key;

    rows.push({
      name,
      type: described.type,
      required: !peeled.optional,
      constraint: described.constraints.join("；"),
      message: described.messages.join("；"),
    });

    if (depth >= MAX_NESTING) continue;

    const valueDef = defOf(peeled.schema);

    if (valueDef?.type === "object" || valueDef?.type === "intersection") {
      addObjectFields(peeled.schema, name, rows, depth + 1);
      continue;
    }

    if (valueDef?.type === "array") {
      const element = peel(valueDef.element);
      const elementDef = defOf(element.schema);

      if (elementDef?.type === "object" || elementDef?.type === "intersection") {
        addObjectFields(element.schema, `${name}[]`, rows, depth + 1);
      }
    }
  }
};

/** `.refine()` 这类跨字段规则：结构上表达不出来，单独列一行文字。 */
const collectRules = (schema: unknown, rules: string[]) => {
  const { schema: base } = peel(schema);
  const def = defOf(base);

  if (!def) return;

  if (def.type === "intersection") {
    collectRules(def.left, rules);
    collectRules(def.right, rules);
    return;
  }

  for (const check of def.checks ?? []) {
    const checkDef = checkDefOf(check);

    if (checkDef?.check !== "custom") continue;

    const message = messageOf(checkDef.error);

    if (!message) continue;

    const path = checkDef.path?.join(".");
    rules.push(path ? `${path}：${message}` : message);
  }
};

const hasField = (schema: unknown, field: string): boolean => {
  const { schema: base } = peel(schema);
  const def = defOf(base);

  if (!def) return false;

  if (def.type === "intersection") {
    return hasField(def.left, field) || hasField(def.right, field);
  }

  return def.type === "object" && field in (def.shape ?? {});
};

// ---------------------------------------------------------------------------
// 运行时路由表
// ---------------------------------------------------------------------------

type Endpoint = {
  method: string;
  path: string;
  inputs: ValidatedInput[];
  requiresAuth: boolean;
};

const collectEndpoints = (): Endpoint[] => {
  // `.use(requireUser)` 注册出来的是 "ALL /api/<模块>/*"。用函数**同一性**认它，
  // 而不是猜哪个模块挂了守卫——挂没挂、挂在哪个前缀，运行时说了算。
  const guardedPrefixes = app.routes
    .filter((route) => (route.handler as unknown) === (requireUser as unknown))
    .map((route) => route.path.replace(/\*$/, ""));

  const endpoints = new Map<string, Endpoint>();

  for (const route of app.routes) {
    // 通配路径是中间件挂载点（守卫、静态资源、Better Auth 的 /api/auth/*），
    // 不是一条具体接口。
    if (route.path.includes("*")) continue;

    const key = `${route.method} ${route.path}`;
    const endpoint = endpoints.get(key) ?? {
      method: route.method,
      path: route.path,
      inputs: [],
      requiresAuth: guardedPrefixes.some((prefix) =>
        route.path.startsWith(prefix),
      ),
    };

    // 一条路由链上可能挂多个校验中间件（如文件读取的 param + query）。
    const input = validatedInputs.get(route.handler as unknown as object);

    if (input) endpoint.inputs.push(input);

    endpoints.set(key, endpoint);
  }

  return [...endpoints.values()];
};

// ---------------------------------------------------------------------------
// 源码扫描：补上 JSDoc 说明和行号
// ---------------------------------------------------------------------------

type SourceInfo = { file: string; line: number; description: string };

const toPosix = (value: string) => value.split("\\").join("/");

/** 中日韩文字、全角标点、表意空格——判断"这一侧是不是中文"。 */
const CJK = /[\p{Script=Han}　-〿＀-￯]/u;

/**
 * 把硬折行的几行接回一行。
 *
 * 中文是为了控制行宽才折的，接回去时中间不能凭空多个空格；但只要有一侧是
 * 西文（英文单词、`code`、数字），就得留一个，否则会出现"唯一的例外是GET"
 * 这种糊在一起的读法。
 */
const joinWrapped = (lines: string[]) =>
  lines.reduce((text, line) => {
    if (!text) return line;

    const bothChinese =
      CJK.test(text.slice(-1)) && CJK.test(line.slice(0, 1));

    return text + (bothChinese ? "" : " ") + line;
  }, "");

/** 取紧贴在 `index` 之前的 JSDoc 首段；中间隔了代码就当没有。 */
const docCommentBefore = (content: string, index: number): string => {
  const before = content.slice(0, index).trimEnd();

  if (!before.endsWith("*/")) return "";

  const start = before.lastIndexOf("/**");

  if (start === -1) return "";

  const lines = before
    .slice(start + 3, before.length - 2)
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd());

  const paragraph: string[] = [];

  for (const line of lines) {
    if (line.trim() === "") {
      if (paragraph.length > 0) break;
      continue;
    }

    paragraph.push(line.trim());
  }

  return joinWrapped(paragraph);
};

const readMountPrefixes = async () => {
  const content = await readFile(resolve(SERVER_SRC, "index.ts"), "utf8");
  const prefixes = new Map<string, string>();
  const order: string[] = [];

  for (const match of content.matchAll(
    /\.route\(\s*"(\/[^"]*)"\s*,\s*(\w+)\s*\)/g,
  )) {
    const [, prefix, identifier] = match;

    if (!prefix || !identifier) continue;

    prefixes.set(identifier, prefix);
    if (!order.includes(prefix)) order.push(prefix);
  }

  return { prefixes, order };
};

const scanSources = async (prefixes: Map<string, string>) => {
  const sources = new Map<string, SourceInfo>();
  const glob = new Glob("modules/**/routes*.ts");

  for await (const entry of glob.scan({ cwd: SERVER_SRC })) {
    const relative = toPosix(entry);

    if (relative.includes(".test.")) continue;

    const content = await readFile(resolve(SERVER_SRC, entry), "utf8");
    const owners = [...content.matchAll(/export const (\w+)\s*=/g)].map(
      (match) => ({ name: match[1] ?? "", index: match.index ?? 0 }),
    );

    for (const match of content.matchAll(
      /\.(post|get|put|patch|delete)\(\s*"(\/[^"]*)"/g,
    )) {
      const index = match.index ?? 0;
      const owner = owners.filter((candidate) => candidate.index < index).pop();
      const prefix = owner ? prefixes.get(owner.name) : undefined;

      if (prefix === undefined) continue;

      const method = (match[1] ?? "").toUpperCase();
      const action = match[2] ?? "";
      const path = `${prefix === "/" ? "" : prefix}${action}`.replace(
        /\/{2,}/g,
        "/",
      );

      sources.set(`${method} ${path}`, {
        file: `apps/server/src/${relative}`,
        line: content.slice(0, index).split("\n").length,
        description: docCommentBefore(content, index),
      });
    }
  }

  return sources;
};

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/**
 * 源码引用只写纯文本，不做成链接：产物是发到浏览器里的，
 * `../apps/server/…` 这种相对路径在线上指不到任何东西。
 */
const sourceRef = (file: string, line?: number) =>
  `\`${file}${line === undefined ? "" : `:${line}`}\``;

const escapeCell = (value: string) => value.split("|").join("\\|");

/** 复刻 GitHub 的标题锚点规则：小写、去标点、空格换连字符，CJK 原样保留。 */
const slugify = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/\s+/)
    .join("-");

const headingOf = (endpoint: Endpoint) =>
  `${endpoint.method} \`${endpoint.path}\``;

const renderFieldTable = (schema: unknown): string[] => {
  const rows: FieldRow[] = [];

  addObjectFields(schema, "", rows, 0);

  // 根不是对象（目前没有这种接口，留着兜底）：退化成一句类型描述。
  if (rows.length === 0) {
    const described = describe(peel(schema));
    const notes = [...described.constraints, ...described.messages];

    return [
      `类型：${described.type}${notes.length > 0 ? `（${notes.join("；")}）` : ""}`,
    ];
  }

  return [
    "| 字段 | 类型 | 必填 | 约束 | 校验文案 |",
    "| --- | --- | :---: | --- | --- |",
    ...rows.map((row) => {
      const cells = [
        `\`${row.name}\``,
        escapeCell(row.type),
        row.required ? "是" : "否",
        escapeCell(row.constraint) || "—",
        escapeCell(row.message) || "—",
      ];

      return `| ${cells.join(" | ")} |`;
    }),
  ];
};

const renderEndpoint = (
  endpoint: Endpoint,
  source: SourceInfo | undefined,
): string[] => {
  const lines: string[] = [`### ${headingOf(endpoint)}`, ""];

  if (source?.description) {
    lines.push(`> ${source.description}`, "");
  }

  const meta = [`登录：${endpoint.requiresAuth ? "**需要**" : "不需要"}`];

  if (source) {
    meta.push(`源码：${sourceRef(source.file, source.line)}`);
  }

  lines.push(meta.join(" ・ "), "");

  if (endpoint.inputs.length === 0) {
    lines.push("入参：无。", "");
  }

  for (const input of endpoint.inputs) {
    const rules: string[] = [];

    collectRules(input.schema, rules);

    lines.push(
      `**${TARGET_TITLES[input.target] ?? input.target}**`,
      "",
      ...renderFieldTable(input.schema),
      "",
    );

    if (rules.length > 0) {
      lines.push(
        "跨字段规则：",
        ...rules.map((rule) => `- ${rule}`),
        "",
      );
    }
  }

  const paged = endpoint.inputs.some(
    (input) =>
      hasField(input.schema, "page") && hasField(input.schema, "pageSize"),
  );

  // 业务接口一律 POST（见"全局约定"），非 POST 的按约定就是传输层例外——
  // 成功时返回的是资源本体而不是信封。
  const envelope = "[统一响应信封](#统一响应信封)";

  lines.push(
    endpoint.method !== "POST"
      ? `出参：成功时直接返回资源本体（不套信封）；失败仍返回${envelope}。`
      : paged
        ? `出参：\`{ code: "OK", data: { list, total } }\`，见${envelope}。`
        : `出参：见${envelope}。`,
    "",
  );

  return lines;
};

const moduleOf = (path: string) => `/${path.split("/").slice(1, 3).join("/")}`;

const preamble = (stamp: string) => `# 接口清单

> 本文档在**构建时**从服务端代码生成，与当前部署的这个版本严格同源。
> 构建标记：\`${stamp}\`。
> [下载 Markdown 版本](./api.md)

## 全局约定

- **路径 = \`/api/<模块>/<动作>\`**，前缀只是命名空间，不是 REST 资源路径。
- **业务接口一律用 POST**，HTTP 动词不承载业务含义。唯一的例外是
  \`GET /api/file/:fileId\`——它要支持浏览器原生预览和下载，属于传输层需要。
- **HTTP 状态码不表达业务结果。** 未登录、校验不过、找不到，全都是 HTTP 200，
  靠响应体里的 \`code\` 分支。真正的非 200 只有两种：请求体解析不了，以及
  handler 里没接住的异常（统一 500）。
- 需要登录的接口，未登录时返回 \`{ code: "UNAUTHORIZED" }\`，**不是 401**。

### 统一响应信封

所有接口（文件二进制读取成功时除外）都返回同一个信封，定义在
${sourceRef("apps/server/src/shared/result.ts")}：

\`\`\`ts
{ code: "OK", data: T }
| { code: "UNAUTHORIZED",     message: string }
| { code: "VALIDATION_ERROR", message: string }
| { code: "NOT_FOUND",        message: string }
| { code: "INTERNAL_ERROR",   message: string }
\`\`\`

分页接口的 \`data\` 统一是 \`{ list, total }\`，入参统一带 \`page\` / \`pageSize\`。

**关于出参字段：**服务端刻意不声明出参类型（理由见 \`shared/result.ts\` 的注释），
因此本文档不列 \`data\` 的字段。要精确的出参，看对应 \`routes.ts\` 里显式的字段
投影，或在前端直接用 \`hc<AppType>\` 取类型——那才是权威来源。

### 认证接口

\`/api/auth/*\` 由 Better Auth 自己接管（挂载见
${sourceRef("apps/server/src/modules/auth/routes.ts")}），
不在下面的清单里。它的接口列表以 Better Auth 官方文档为准，前端走的是
\`authClient\`，不是本文档描述的这套业务信封。
`;

type DocModel = {
  modules: string[];
  grouped: Map<string, Endpoint[]>;
  sources: Map<string, SourceInfo>;
  endpoints: Endpoint[];
};

const buildMarkdown = (model: DocModel, stamp: string) => {
  const { modules, grouped, sources } = model;
  const lines: string[] = [preamble(stamp), "## 模块总览", ""];

  lines.push("| 模块 | 前缀 | 接口数 | 登录 |", "| --- | --- | ---: | :---: |");

  for (const module of modules) {
    const bucket = grouped.get(module) ?? [];
    const allGuarded = bucket.every((endpoint) => endpoint.requiresAuth);
    const noneGuarded = bucket.every((endpoint) => !endpoint.requiresAuth);
    const title = MODULE_TITLES[module] ?? module.replace("/api/", "");

    lines.push(
      `| [${title}](#${slugify(title)}) | \`${module}\` | ${bucket.length} | ${
        allGuarded ? "需要" : noneGuarded ? "不需要" : "部分"
      } |`,
    );
  }

  lines.push("");

  for (const module of modules) {
    const bucket = grouped.get(module) ?? [];
    const title = MODULE_TITLES[module] ?? module.replace("/api/", "");

    const index = bucket
      .map((endpoint) => {
        const action = endpoint.path.slice(module.length) || "/";
        const label =
          endpoint.method === "POST" ? action : `${endpoint.method} ${action}`;

        return `[\`${label}\`](#${slugify(headingOf(endpoint))})`;
      })
      .join(" ・ ");

    lines.push(
      `## ${title}`,
      "",
      `前缀 \`${module}\`，共 ${bucket.length} 个接口。`,
      "",
      index,
      "",
    );

    for (const endpoint of bucket) {
      lines.push(
        ...renderEndpoint(
          endpoint,
          sources.get(`${endpoint.method} ${endpoint.path}`),
        ),
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
};

// ---------------------------------------------------------------------------
// HTML 产物
//
// 这里的 markdown→HTML 只覆盖**上面这个生成器自己会吐出来的那几种结构**
// （标题、引用、表格、列表、围栏代码、行内 code/加粗/链接），所以不需要引一个
// markdown 解析器：输入不是任意 markdown，是我们自己写死的那几行。
// ---------------------------------------------------------------------------

const escapeHtml = (value: string) =>
  value.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");

/** 抠出行内代码时的占位符：NUL 绝不会出现在文档正文里。 */
const PLACEHOLDER = "\u0000";

const renderInline = (text: string) => {
  // 先把行内代码抠出来占位：代码里的 `**` 和 `[]` 不该再被当成标记。
  const codes: string[] = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(code);

    return `${PLACEHOLDER}${codes.length - 1}${PLACEHOLDER}`;
  });

  html = html
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, label: string, href: string) => `<a href="${href}">${label}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g"),
      (_match, index: string) => `<code>${codes[Number(index)]}</code>`,
    );

  return html;
};

/** 表格单元格：按**未转义**的竖线切分，再把 `\|` 还原成字面量。 */
const splitCells = (row: string) =>
  row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().split("\\|").join("|"));

const markdownToHtml = (markdown: string) => {
  const lines = markdown.split("\n");
  const html: string[] = [];
  let index = 0;

  const isTableSeparator = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];

      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;

      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);

    if (heading) {
      const level = (heading[1] ?? "#").length;
      const text = heading[2] ?? "";

      html.push(
        `<h${level} id="${slugify(text)}">${renderInline(text)}</h${level}>`,
      );
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];

      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }

      html.push(
        `<blockquote><p>${renderInline(joinWrapped(quote))}</p></blockquote>`,
      );
      continue;
    }

    if (line.startsWith("|") && isTableSeparator(lines[index + 1] ?? "")) {
      const head = splitCells(line);
      const body: string[][] = [];

      index += 2;
      while (index < lines.length && (lines[index] ?? "").startsWith("|")) {
        body.push(splitCells(lines[index] ?? ""));
        index += 1;
      }

      html.push(
        "<div class=\"table-scroll\"><table><thead><tr>",
        ...head.map((cell) => `<th>${renderInline(cell)}</th>`),
        "</tr></thead><tbody>",
        ...body.map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`,
        ),
        "</tbody></table></div>",
      );
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index] ?? "";

        if (current.startsWith("- ")) {
          items.push(current.slice(2));
          index += 1;
          continue;
        }

        // 缩进的续行：markdown 里为了控制行宽把一条 item 折成了几行，
        // 不接回去的话它会掉出 <ul> 变成一个独立段落。
        const last = items.length - 1;
        const previous = items[last];

        if (/^\s+\S/.test(current) && previous !== undefined) {
          items[last] = joinWrapped([previous, current.trim()]);
          index += 1;
          continue;
        }

        break;
      }

      html.push(
        `<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`,
      );
      continue;
    }

    const paragraph: string[] = [];

    while (index < lines.length) {
      const current = lines[index] ?? "";

      if (
        current.trim() === "" ||
        current.startsWith("#") ||
        current.startsWith(">") ||
        current.startsWith("|") ||
        current.startsWith("- ") ||
        current.startsWith("```")
      ) {
        break;
      }

      paragraph.push(current);
      index += 1;
    }

    html.push(`<p>${renderInline(joinWrapped(paragraph))}</p>`);
  }

  return html.join("\n");
};

const htmlPage = (body: string) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>接口清单</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #61656b;
  --line: #e2e5e9;
  --accent: #1a56db;
  --code-bg: #f3f4f6;
  --quote-bg: #f7f8fa;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c;
    --fg: #e6e8eb;
    --muted: #9aa1aa;
    --line: #2c3037;
    --accent: #7aa2f7;
    --code-bg: #22262c;
    --quote-bg: #1c1f24;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 2.5rem 1.25rem 6rem;
  max-width: 60rem;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
h1 { font-size: 1.9rem; margin: 0 0 1.5rem; }
h2 {
  font-size: 1.4rem;
  margin: 3.5rem 0 1rem;
  padding-bottom: .4rem;
  border-bottom: 1px solid var(--line);
}
h3 {
  font-size: 1.05rem;
  margin: 2.5rem 0 .75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
p, ul { margin: .75rem 0; }
ul { padding-left: 1.25rem; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  background: var(--code-bg);
  padding: .1em .35em;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .875em;
}
pre {
  background: var(--code-bg);
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
}
pre code { background: none; padding: 0; }
blockquote {
  margin: 1rem 0;
  padding: .75rem 1rem;
  background: var(--quote-bg);
  border-left: 3px solid var(--line);
  border-radius: 0 6px 6px 0;
  color: var(--muted);
}
blockquote p { margin: 0; }
.table-scroll { overflow-x: auto; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td {
  border: 1px solid var(--line);
  padding: .4rem .6rem;
  text-align: left;
  vertical-align: top;
}
th { background: var(--quote-bg); font-weight: 600; white-space: nowrap; }
h3 + p { color: var(--muted); font-size: .875rem; }
</style>
</head>
<body>
${body}
</body>
</html>
`;

// ---------------------------------------------------------------------------

/**
 * 构建标记：让线上那份能说清自己是哪次构建的产物。
 * Docker 构建上下文按 .dockerignore 排除了 .git，那时拿不到 commit，退回时间戳。
 */
const buildStamp = () => {
  const time = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;

  try {
    const git = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      stderr: "ignore",
    });

    const commit = git.success ? git.stdout.toString().trim() : "";

    return commit ? `${commit} · ${time}` : time;
  } catch {
    return time;
  }
};

const main = async () => {
  const { prefixes, order } = await readMountPrefixes();
  const sources = await scanSources(prefixes);
  const endpoints = collectEndpoints();

  const grouped = new Map<string, Endpoint[]>();

  for (const endpoint of endpoints) {
    const module = moduleOf(endpoint.path);
    const bucket = grouped.get(module) ?? [];

    bucket.push(endpoint);
    grouped.set(module, bucket);
  }

  // 按 index.ts 里的挂载顺序输出，读文档的顺序和读代码的顺序一致。
  const modules = [
    ...order.filter((prefix) => grouped.has(prefix)),
    ...[...grouped.keys()].filter((prefix) => !order.includes(prefix)),
  ];

  const model: DocModel = { modules, grouped, sources, endpoints };
  const markdown = buildMarkdown(model, buildStamp());

  await mkdir(OUTPUT_DIR, { recursive: true });

  await Promise.all([
    writeFile(resolve(OUTPUT_DIR, "api.md"), markdown, "utf8"),
    writeFile(
      resolve(OUTPUT_DIR, "api.html"),
      htmlPage(markdownToHtml(markdown)),
      "utf8",
    ),
  ]);

  console.log(
    `${modules.length} 个模块，${endpoints.length} 个接口 → apps/web/public/docs/{api.md,api.html}`,
  );

  const undocumented = endpoints.filter(
    (endpoint) => !sources.has(`${endpoint.method} ${endpoint.path}`),
  );

  if (undocumented.length > 0) {
    // 扫不到源码位置不影响清单正确性，但值得知道——通常意味着某个 routes.ts
    // 的写法超出了扫描器的假设。
    console.log(
      `未能定位源码行号：${undocumented.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(", ")}`,
    );
  }
};

await main();
