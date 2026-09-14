import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { YAML } from "bun";
import { inspectSkills, syncSkills } from "./skills";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(`${resolve(tmpdir())}${sep}skill-adapters-`))
      throw new Error("拒绝清理非测试临时目录");
    rmSync(directory, { recursive: true });
  }
});

function put(root: string, path: string, text: string) {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
}

const source =
  '---\nname: sample\ndescription: 修改示例组件时使用\nmetadata:\n  claude-user-invocable: "false"\n---\n\n先读 [规范](../../../docs/sample.md)。\n';
const sourcePath = ".agents/skills/sample/SKILL.md";
const targetPath = ".claude/skills/sample/SKILL.md";
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "skill-adapters-"));
  directories.push(root);
  put(root, sourcePath, source);
  put(root, "docs/sample.md", "# 规范\n");
  return root;
}

test("入口可随仓库交付，保留调用策略并指向唯一正文；CRLF 不产生漂移", () => {
  const root = fixture();
  expect(syncSkills(root)).toBe(1);
  const text = readFileSync(resolve(root, targetPath), "utf8");
  const header = YAML.parse(text.split("---")[1]) as Record<string, unknown>;
  expect(header.name).toBe("sample");
  expect(header["user-invocable"]).toBe(false);
  const link = text.match(/\]\(([^)]+)\)/)?.[1];
  expect(link).toBeDefined();
  expect(resolve(dirname(resolve(root, targetPath)), link ?? "")).toBe(
    resolve(root, sourcePath),
  );
  put(root, targetPath, text.replaceAll("\n", "\r\n"));
  expect(syncSkills(root)).toBe(0);
});

test("正文修订不复制；描述变化会被只读检查发现", () => {
  const root = fixture();
  syncSkills(root);
  put(root, sourcePath, `${source}\n补充当前步骤。\n`);
  expect(inspectSkills(root).pending).toHaveLength(0);
  put(
    root,
    sourcePath,
    source.replace("修改示例组件时使用", "修改组件或组件配置时使用"),
  );
  const before = readFileSync(resolve(root, targetPath), "utf8");
  expect(inspectSkills(root).pending).toHaveLength(1);
  expect(readFileSync(resolve(root, targetPath), "utf8")).toBe(before);
  expect(syncSkills(root)).toBe(1);
});

test("损坏的来源和断开的参考链接阻止同步，不生成半套入口", () => {
  const root = fixture();
  put(
    root,
    sourcePath,
    source.replace("../../../docs/sample.md", "missing.md"),
  );
  expect(() => syncSkills(root)).toThrow("本地链接不存在");
  expect(existsSync(resolve(root, targetPath))).toBe(false);
  put(root, sourcePath, source.replace("name: sample", "name: wrong"));
  expect(() => syncSkills(root)).toThrow("name");
  put(
    root,
    sourcePath,
    source.replace("metadata:", "allowed-tools: Bash(*)\nmetadata:"),
  );
  expect(() => syncSkills(root)).toThrow("未适配的宿主字段");
});

test("不覆盖已有独立入口，不自动删除失去来源的生成文件", () => {
  const root = fixture();
  put(root, targetPath, "# 已有手写入口\n");
  expect(() => syncSkills(root)).toThrow("不能自动覆盖");
  expect(readFileSync(resolve(root, targetPath), "utf8")).toBe(
    "# 已有手写入口\n",
  );
  rmSync(resolve(root, targetPath));
  syncSkills(root);
  const skillDirectory = resolve(root, ".agents/skills/sample");
  if (!skillDirectory.startsWith(`${root}${sep}`))
    throw new Error("非法测试路径");
  rmSync(skillDirectory, { recursive: true });
  expect(inspectSkills(root).errors.join()).toContain("源 skill 已移除");
  expect(existsSync(resolve(root, targetPath))).toBe(true);
});

test("仓库 skill 来源与已提交的宿主入口保持一致", () => {
  const result = inspectSkills(resolve(import.meta.dir, ".."));
  expect(result.errors).toEqual([]);
  expect(result.pending).toEqual([]);
});
