import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync } from "fflate";
import {
  addInvitationDownloadEntry,
  prepareInvitationDownload,
} from "./download";
import { convertInvitationPdfs } from "./pdf";

let temporary: string;
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), "office-test-"));
});
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});
const command = (mode = "success") => [
  process.execPath,
  join(import.meta.dir, "__fixtures__/office-process.ts"),
  mode,
  join(temporary, "started.json"),
];
const doc = strToU8("recipient-one");
async function started() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return JSON.parse(
        await readFile(join(temporary, "started.json"), "utf8"),
      ) as { directory: string; pid: number; args: string[] };
    } catch {
      await Bun.sleep(10);
    }
  }
  throw new Error("conversion process did not start");
}
function stopped(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

test("同名收件人不会覆盖 ZIP 中的其他邀请函", async () => {
  const entries: Record<string, Uint8Array> = {};
  addInvitationDownloadEntry(entries, "模板——张三.docx", doc);
  addInvitationDownloadEntry(entries, "模板——张三.docx", strToU8("second"));
  const result = await prepareInvitationDownload(entries, "docx", "batch.zip");
  expect(Object.keys(unzipSync(result.bytes))).toEqual([
    "模板——张三.docx",
    "模板——张三（2）.docx",
  ]);
});

test("真实子进程按输入编号交付整批，使用独立 profile，成功后清理", async () => {
  const output = await convertInvitationPdfs([doc, strToU8("recipient-two")], {
    command: command(),
  });
  expect(output.map((bytes) => strFromU8(bytes))).toEqual([
    "%PDF-1.7\nrecipient-one",
    "%PDF-1.7\nrecipient-two",
  ]);
  const info = await started();
  expect(info.args).toContain("--headless");
  expect(
    info.args.some((arg) => arg.startsWith("-env:UserInstallation=file:")),
  ).toBe(true);
  expect(existsSync(info.directory)).toBe(false);
});

test.each([
  "missing",
  "invalid",
  "failure",
])("%s 转换不能交付部分结果且清理目录", async (mode) => {
  await expect(
    convertInvitationPdfs([doc, doc], { command: command(mode) }),
  ).rejects.toThrow("PDF 转换");
  expect(existsSync((await started()).directory)).toBe(false);
});

test("输出超过上限时在读取前拒绝，清理稀疏测试文件", async () => {
  await expect(
    convertInvitationPdfs([doc], { command: command("large") }),
  ).rejects.toThrow("500 MB");
  expect(existsSync((await started()).directory)).toBe(false);
});

test("超时终止实际子进程，释放转换名额并清理文件", async () => {
  const conversion = convertInvitationPdfs([doc], {
    command: command("hang"),
    timeoutMs: 1000,
  });
  const rejected = expect(conversion).rejects.toThrow("转换超时");
  const info = await started();
  await rejected;
  expect(stopped(info.pid)).toBe(true);
  expect(existsSync(info.directory)).toBe(false);
  expect(
    await convertInvitationPdfs([doc], { command: command() }),
  ).toHaveLength(1);
});

test("繁忙时拒绝第二批，取消第一批会终止进程并清理", async () => {
  const controller = new AbortController();
  const conversion = convertInvitationPdfs([doc], {
    command: command("hang"),
    signal: controller.signal,
  });
  const outcome = conversion.catch((error: unknown) => error);
  const info = await started();
  try {
    await expect(
      convertInvitationPdfs([doc], { command: command() }),
    ).rejects.toThrow("其他 PDF");
  } finally {
    controller.abort();
  }
  expect(await outcome).toBeInstanceOf(Error);
  expect(((await outcome) as Error).message).toContain("已取消");
  expect(stopped(info.pid)).toBe(true);
  expect(existsSync(info.directory)).toBe(false);
});

test("已取消的请求不启动子进程", async () => {
  await expect(
    convertInvitationPdfs([doc], {
      command: command(),
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow("已取消");
  expect(existsSync(join(temporary, "started.json"))).toBe(false);
});

test("程序缺失时返回可操作错误，Word 不依赖转换器", async () => {
  await expect(
    convertInvitationPdfs([doc], {
      command: [join(temporary, "missing-office")],
    }),
  ).rejects.toThrow("转换程序暂不可用");
  expect(
    (await prepareInvitationDownload({ "模板——张三.docx": doc }, "docx")).bytes,
  ).toBe(doc);
  expect(
    await convertInvitationPdfs([doc], { command: command() }),
  ).toHaveLength(1);
});

test("空批次或超过 200 份不启动转换", async () => {
  for (const inputs of [[], Array.from({ length: 201 }, () => doc)])
    await expect(
      convertInvitationPdfs(inputs, { command: command() }),
    ).rejects.toThrow("1–200");
  expect(existsSync(join(temporary, "started.json"))).toBe(false);
});
