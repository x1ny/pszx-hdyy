import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PDF_CONVERSION_TIMEOUT_MS = 180_000;
export const INVITATION_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;
export class InvitationPdfError extends Error {}

// 同一 Bun 进程（含管理端和 H5）只启动一批转换，避免多个 Office 进程挤占应用内存。
let converting = false;
const invalidOutput = () =>
  new InvitationPdfError("PDF 转换结果不完整，请重试或改选 Word 下载");
const tooLarge = () =>
  new InvitationPdfError("本次下载超过 500 MB，请缩小范围分批下载");

function libreOfficeCommand() {
  const configured = process.env.LIBREOFFICE_PATH?.trim();
  if (configured) return [configured];
  const binary = Bun.which("soffice") ?? Bun.which("libreoffice");
  if (binary) return [binary];
  const windowsBinary = "C:\\Program Files\\LibreOffice\\program\\soffice.com";
  if (process.platform === "win32" && existsSync(windowsBinary))
    return [windowsBinary];
  throw new InvitationPdfError(
    "未找到 PDF 转换程序，请安装 LibreOffice 或使用包含它的应用镜像，也可改选 Word 下载",
  );
}

/** 不经过 shell；取消时杀掉整个转换进程组，等待退出后才能删除文件或接受下一批。 */
async function runOffice(
  command: string[],
  args: string[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const executable = command[0];
  if (!executable) throw invalidOutput();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...command.slice(1), ...args], {
      stdio: "ignore",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          {
            windowsHide: true,
            stdio: "ignore",
          },
        );
        killer.on("error", () => child.kill("SIGKILL"));
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    signal.addEventListener("abort", kill, { once: true });
    child.once("error", (error) => {
      signal.removeEventListener("abort", kill);
      reject(error);
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", kill);
      if (code === 0) resolve();
      else
        reject(
          new InvitationPdfError("PDF 转换失败，请检查模板或改选 Word 下载"),
        );
    });
    if (signal.aborted) kill();
  });
  signal.throwIfAborted();
}

/** 每批独立临时目录和用户配置。command 仅供进程集成测试注入，不接收 HTTP 输入。 */
export async function convertInvitationPdfs(
  documents: Uint8Array[],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    command?: string[];
  } = {},
): Promise<Uint8Array[]> {
  if (documents.length === 0 || documents.length > 200)
    throw new InvitationPdfError("请选择 1–200 份邀请函");
  if (
    documents.reduce((sum, file) => sum + file.byteLength, 0) >
    INVITATION_DOWNLOAD_MAX_BYTES
  )
    throw tooLarge();
  if (options.signal?.aborted) throw new InvitationPdfError("PDF 下载已取消");
  if (converting)
    throw new InvitationPdfError(
      "正在处理其他 PDF 下载，请稍后重试或改选 Word 下载",
    );
  const command = options.command ?? libreOfficeCommand();
  converting = true;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? PDF_CONVERSION_TIMEOUT_MS,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "invitation-pdf-"));
    const profile = join(directory, "profile");
    await mkdir(join(profile, "user"), { recursive: true });
    // 禁用宏和自动外链更新，每批不依赖宿主上次打开 Office 的状态。
    await writeFile(
      join(profile, "user", "registrymodifications.xcu"),
      '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>',
    );
    const inputs: string[] = [];
    for (const [index, bytes] of documents.entries()) {
      signal.throwIfAborted();
      const input = join(directory, `invitation-${index}.docx`);
      await writeFile(input, bytes, { signal });
      inputs.push(input);
    }
    const filter = JSON.stringify({
      ExportNotes: { type: "boolean", value: "false" },
      ExportFormFields: { type: "boolean", value: "false" },
      IsSkipEmptyPages: { type: "boolean", value: "true" },
    });
    await runOffice(
      command,
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        "--norestore",
        "--convert-to",
        `pdf:writer_pdf_Export:${filter}`,
        "--outdir",
        directory,
        ...inputs,
      ],
      signal,
    );
    const files: Uint8Array[] = [];
    let outputSize = 0;
    for (const index of documents.keys()) {
      signal.throwIfAborted();
      const output = join(directory, `invitation-${index}.pdf`);
      const info = await stat(output).catch(() => {
        throw invalidOutput();
      });
      outputSize += info.size;
      if (outputSize > INVITATION_DOWNLOAD_MAX_BYTES) throw tooLarge();
      const bytes = await readFile(output, { signal });
      if (bytes.subarray(0, 5).toString() !== "%PDF-") throw invalidOutput();
      files.push(bytes);
    }
    return files;
  } catch (error) {
    if (controller.signal.aborted)
      throw new InvitationPdfError(
        "PDF 转换超时，请减少下载份数后重试或改选 Word 下载",
      );
    if (options.signal?.aborted) throw new InvitationPdfError("PDF 下载已取消");
    if (error instanceof InvitationPdfError) throw error;
    throw new InvitationPdfError(
      "PDF 转换程序暂不可用，请联系管理员或改选 Word 下载",
    );
  } finally {
    clearTimeout(timer);
    try {
      // directory 仅来自本次 mkdtemp，不使用请求中的路径，也不会删除上传模板。
      if (directory)
        await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    } finally {
      converting = false;
    }
  }
}
