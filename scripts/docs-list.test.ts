import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  checkLocalLinks,
  checkRoot,
  inspectKnowledge,
  parseDocument,
  selectDocuments,
} from "./docs-list";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
});

const current = `---
status: current
summary: H5 分享与访问规则
read_when:
  - 修改分享入口
---
# H5
`;
const root = [
  "Skill Loading",
  "工作方式",
  "通用边界",
  "常用命令",
  "按任务读取",
  "验证与交付",
  "知识维护",
]
  .map((heading) => `## ${heading}\n`)
  .join("\n");

describe("知识入口", () => {
  test("历史文件不自动成为当前资料；搜索命中阅读条件", () => {
    expect(parseDocument("old.md", "# 历史记录")).toBeNull();
    const doc = parseDocument("docs/h5.md", current);
    if (!doc) throw new Error("fixture should have metadata");
    const historical = {
      ...doc,
      path: "docs/old.md",
      status: "historical" as const,
    };
    expect(selectDocuments([doc, historical], false, "分享入口")).toEqual([
      doc,
    ]);
    expect(selectDocuments([doc, historical], true, "h5")).toHaveLength(2);
  });

  test("兼容 CRLF；损坏或不完整的元数据不能悄悄跳过", () => {
    expect(
      parseDocument("h5.md", current.replaceAll("\n", "\r\n"))?.status,
    ).toBe("current");
    expect(() => parseDocument("bad.md", "---\nstatus: current\n")).toThrow(
      "bad.md",
    );
    expect(() =>
      parseDocument("bad.md", current.replace("current", "curent")),
    ).toThrow("status");
    expect(() =>
      parseDocument("bad.md", current.replace("  - 修改分享入口", "  - 123")),
    ).toThrow("read_when");
    expect(() => parseDocument("bad.md", "---\nsummary: [\n---\n")).toThrow(
      "YAML",
    );
  });

  test("根章节扩张、中文字节超限及专题全文导入被拦截", () => {
    expect(checkRoot(root, "@AGENTS.md\r\n")).toEqual([]);
    expect(
      checkRoot(`${root}\n## 新功能的并存状态\n`, "@AGENTS.md"),
    ).not.toEqual([]);
    expect(checkRoot(`${root}\n### 模块细节\n`, "@AGENTS.md")).not.toEqual([]);
    expect(
      checkRoot(`${root}${"中".repeat(11000)}`, "@AGENTS.md").join(),
    ).toContain("32 KiB");
    expect(checkRoot(root, "@AGENTS.md\n@docs/all.md").join()).toContain(
      "CLAUDE",
    );
  });

  test("真实文件链接支持中文、空格与编码；代码块范例不误报", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "knowledge-links-"));
    directories.push(directory);
    mkdirSync(resolve(directory, "docs"));
    writeFileSync(resolve(directory, "docs/中文 空格.md"), "# 说明");
    const text =
      "[甲](<中文 空格.md>) [乙](中文%20空格.md#说明) [外网](https://example.com)\n" +
      "```md\n[范例](不存在.md)\n```\n[错](missing.md)\n[坏编码](%XX.md)";
    const errors = checkLocalLinks(directory, "docs/index.md", text);
    expect(errors).toHaveLength(2);
    expect(errors.join()).toContain("missing.md");
    expect(errors.join()).toContain("编码无效");
  });

  test("扫描排除原型；根入口不得指向未采纳草案", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "knowledge-scan-"));
    directories.push(directory);
    mkdirSync(resolve(directory, "docs/新版H5_Demo"), { recursive: true });
    mkdirSync(resolve(directory, "docker"));
    writeFileSync(resolve(directory, "docs/新版H5_Demo/demo.md"), current);
    writeFileSync(
      resolve(directory, "docs/draft.md"),
      current.replace("current", "draft"),
    );
    writeFileSync(resolve(directory, "docker/README.md"), "# Docker");
    writeFileSync(
      resolve(directory, "AGENTS.md"),
      `${root}\n[草案](docs/draft.md)`,
    );
    writeFileSync(resolve(directory, "CLAUDE.md"), "@AGENTS.md");
    const result = inspectKnowledge(directory);
    expect(result.documents.map((doc) => doc.path)).toEqual(["docs/draft.md"]);
    expect(result.errors.join()).toContain("缺少 current");
  });

  test("仓库当前知识入口满足约束", () => {
    expect(inspectKnowledge(resolve(import.meta.dir, "..")).errors).toEqual([]);
  });
});
