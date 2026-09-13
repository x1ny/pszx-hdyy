import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { YAML } from "bun";

const statuses = ["current", "reference", "historical", "draft"] as const;
type Status = (typeof statuses)[number];
type Document = {
  path: string;
  status: Status;
  summary: string;
  readWhen: string[];
};

const excludedDirectories = new Set([
  "20260811交接",
  "新版H5_Demo",
  "node_modules",
]);
const rootHeadings = [
  "Skill Loading",
  "工作方式",
  "通用边界",
  "常用命令",
  "按任务读取",
  "验证与交付",
  "知识维护",
];

function withoutCode(text: string) {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
}

export function parseDocument(path: string, text: string): Document | null {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---\n", 3);
  if (end === -1) throw new Error(`${path}: frontmatter 缺少结束行 ---`);
  let data: unknown;
  try {
    data = YAML.parse(normalized.slice(4, end));
  } catch {
    throw new Error(`${path}: frontmatter 不是合法 YAML`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${path}: frontmatter 必须是对象`);
  }
  const fields = data as Record<string, unknown>;
  if (
    !statuses.includes(fields.status as Status) ||
    typeof fields.summary !== "string" ||
    !fields.summary.trim() ||
    !Array.isArray(fields.read_when) ||
    fields.read_when.length === 0 ||
    !fields.read_when.every(
      (item: unknown) => typeof item === "string" && item.trim(),
    )
  ) {
    throw new Error(
      `${path}: 需要有效 status、非空 summary 和 read_when 字符串数组`,
    );
  }
  return {
    path,
    status: fields.status as Status,
    summary: fields.summary.trim(),
    readWhen: fields.read_when.map((item: string) => item.trim()),
  };
}

export function selectDocuments(
  documents: Document[],
  all = false,
  query = "",
) {
  const needle = query.toLocaleLowerCase();
  return documents.filter(
    (doc) =>
      (all || doc.status === "current") &&
      [doc.path, doc.summary, ...doc.readWhen]
        .join("\n")
        .toLocaleLowerCase()
        .includes(needle),
  );
}

export function checkRoot(agents: string, claude: string) {
  const errors: string[] = [];
  if (Buffer.byteLength(agents, "utf8") >= 32 * 1024) {
    errors.push("AGENTS.md: 必须小于 32 KiB；将专题迁至 docs，不能继续追加");
  }
  if (claude.trim() !== "@AGENTS.md") {
    errors.push("CLAUDE.md: 只保留 @AGENTS.md，不展开导入专题全文");
  }
  const content = withoutCode(agents.replace(/\r\n/g, "\n"));
  const headings = [...content.matchAll(/^## (.+)$/gm)].map(
    (match) => match[1],
  );
  if (
    headings.join("\n") !== rootHeadings.join("\n") ||
    /^#{3,} /m.test(content)
  ) {
    errors.push(
      "AGENTS.md: 根文件仅允许固定通用章节，不新增模块/功能章节或子章节；" +
        "按 docs/knowledge-maintenance.md 选择归属，新专题由 docs:list 发现",
    );
  }
  return errors;
}

export function checkLocalLinks(root: string, path: string, text: string) {
  const errors: string[] = [];
  const content = withoutCode(text.replace(/\r\n/g, "\n"));
  // 仅检查 Markdown 行内文件链接；代码块中的范例、外网和标题锚点不作文件解析。
  for (const match of content.matchAll(
    /\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g,
  )) {
    const target = match[1] ?? match[2];
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
    let file: string;
    try {
      file = decodeURIComponent(target.split(/[?#]/)[0]);
    } catch {
      errors.push(`${path}: 链接编码无效 ${target}`);
      continue;
    }
    if (!file) continue;
    const absolute = file.startsWith("/")
      ? resolve(root, `.${file}`)
      : resolve(root, dirname(path), file);
    if (!existsSync(absolute)) errors.push(`${path}: 本地链接不存在 ${target}`);
  }
  return errors;
}

export function inspectKnowledge(root: string) {
  const documents: Document[] = [];
  const errors: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name, "en"),
    )) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        inspect(path);
      }
    }
  }
  function inspect(absolute: string) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const text = readFileSync(absolute, "utf8");
    try {
      const doc = parseDocument(path, text);
      if (!doc) return;
      documents.push(doc);
      if (doc.status === "current")
        errors.push(...checkLocalLinks(root, path, text));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  visit(resolve(root, "docs"));
  inspect(resolve(root, "docker/README.md"));
  const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
  errors.push(
    ...checkRoot(agents, readFileSync(resolve(root, "CLAUDE.md"), "utf8")),
  );
  errors.push(...checkLocalLinks(root, "AGENTS.md", agents));
  // 根文档导航必须接到被明确标为 current 的专题，不能链向一份未采纳方案。
  for (const match of agents.matchAll(
    /\]\((docs\/[^)#]+\.md|docker\/README\.md)(?:#[^)]*)?\)/g,
  )) {
    if (
      !documents.some(
        (doc) => doc.path === match[1] && doc.status === "current",
      )
    ) {
      errors.push(`AGENTS.md: 当前入口 ${match[1]} 缺少 current 元数据`);
    }
  }
  return { documents, errors, rootBytes: Buffer.byteLength(agents, "utf8") };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let query = "";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (
      arg === "--query" &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    ) {
      query = args[++index];
    } else if (arg !== "--all" && arg !== "--check") {
      console.error(
        "用法: bun run docs:list [--query 关键词] [--all]；bun run docs:check",
      );
      process.exit(1);
    }
  }
  const result = inspectKnowledge(resolve(import.meta.dir, ".."));
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  if (result.rootBytes > 10 * 1024) {
    console.error(
      `提示：AGENTS.md ${result.rootBytes} 字节，超过 10 KiB 软目标，请复核收录范围`,
    );
  }
  if (args.includes("--check")) {
    console.log(
      `知识入口检查通过：${result.documents.length} 份已标记文档，AGENTS ${result.rootBytes} 字节`,
    );
  } else {
    const selected = selectDocuments(
      result.documents,
      args.includes("--all"),
      query,
    );
    for (const doc of selected) {
      console.log(
        `${doc.path} [${doc.status}]\n  ${doc.summary}\n  何时读：${doc.readWhen.join("；")}\n`,
      );
    }
    if (!selected.length)
      console.log(
        "没有匹配的已标记资料；换关键词，或用 rg 查找未纳入索引的内容。",
      );
  }
}
