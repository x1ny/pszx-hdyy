import { unzipSync } from "fflate";

export const PDF_CONVERSION_TIMEOUT_MS = 180_000;
export const INVITATION_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

export class InvitationPdfError extends Error {}

const invalidOutput = () =>
  new InvitationPdfError("PDF 转换结果不完整，请重试或改选 Word 下载");
const tooLarge = () =>
  new InvitationPdfError("本次下载超过 500 MB，请缩小范围分批下载");
const isPdf = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

/** 只把已填好变量的 DOCX 交给内网转换器；临时文件名不包含收件人信息。 */
export async function convertInvitationPdfs(
  documents: Uint8Array[],
  options: { url?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Uint8Array[]> {
  const url = options.url ?? process.env.GOTENBERG_URL?.trim();
  if (!url)
    throw new InvitationPdfError(
      "PDF 导出服务尚未配置，请联系管理员或改选 Word 下载",
    );
  if (documents.length === 0 || documents.length > 200) {
    throw new InvitationPdfError("请选择 1–200 份邀请函");
  }
  const timeout = AbortSignal.timeout(
    options.timeoutMs ?? PDF_CONVERSION_TIMEOUT_MS,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  try {
    const endpoint = new URL(
      `${url.replace(/\/+$/, "")}/forms/libreoffice/convert`,
    );
    if (!["http:", "https:"].includes(endpoint.protocol)) throw invalidOutput();
    const form = new FormData();
    let inputSize = 0;
    documents.forEach((bytes, index) => {
      inputSize += bytes.byteLength;
      if (inputSize > INVITATION_DOWNLOAD_MAX_BYTES) throw tooLarge();
      form.append(
        "files",
        new Blob([Uint8Array.from(bytes)]),
        `invitation-${index}.docx`,
      );
    });
    form.set("exportNotes", "false");
    form.set("exportFormFields", "false");
    form.set("skipEmptyPages", "true");
    const response = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new InvitationPdfError(
        response.status === 503 || response.status === 504
          ? "PDF 转换超时或服务繁忙，请稍后重试，批量下载可减少份数"
          : "PDF 转换失败，请检查模板或改选 Word 下载",
      );
    }
    const mime = response.headers.get("content-type")?.split(";")[0];
    if (
      mime !== (documents.length === 1 ? "application/pdf" : "application/zip")
    ) {
      await response.body?.cancel();
      throw invalidOutput();
    }
    if (
      Number(response.headers.get("content-length")) >
      INVITATION_DOWNLOAD_MAX_BYTES
    ) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const reader = response.body?.getReader();
    if (!reader) throw invalidOutput();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > INVITATION_DOWNLOAD_MAX_BYTES) throw tooLarge();
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (documents.length === 1) {
      if (!isPdf(output)) throw invalidOutput();
      return [output];
    }
    let unpackedSize = 0;
    const files = unzipSync(output, {
      filter: (entry) => {
        unpackedSize += entry.originalSize;
        if (unpackedSize > INVITATION_DOWNLOAD_MAX_BYTES) throw tooLarge();
        return true;
      },
    });
    if (Object.keys(files).length !== documents.length) throw invalidOutput();
    return documents.map((_, index) => {
      // Gotenberg 保留输入扩展名，实际 ZIP 条目为 invitation-0.docx.pdf。
      const pdf = files[`invitation-${index}.docx.pdf`];
      if (!pdf || !isPdf(pdf)) throw invalidOutput();
      return pdf;
    });
  } catch (error) {
    if (timeout.aborted)
      throw new InvitationPdfError(
        "PDF 转换超时，请减少下载份数后重试或改选 Word 下载",
      );
    if (options.signal?.aborted) throw new InvitationPdfError("PDF 下载已取消");
    if (error instanceof InvitationPdfError) throw error;
    throw new InvitationPdfError(
      "PDF 导出服务暂不可用，请稍后重试或改选 Word 下载",
    );
  }
}
