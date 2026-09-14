import { zipSync } from "fflate";
import {
  convertInvitationPdfs,
  INVITATION_DOWNLOAD_MAX_BYTES,
  InvitationPdfError,
} from "./pdf";
import { prepareDocxForPdf } from "./pdf-source";

export type InvitationDownloadFormat = "docx" | "pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 同名收件人（含文件名清理后同名）必须保留全部邀请函，不能在 ZIP 中互相覆盖。 */
export function addInvitationDownloadEntry(
  entries: Record<string, Uint8Array>,
  name: string,
  bytes: Uint8Array,
) {
  let uniqueName = name;
  let duplicate = 2;
  while (Object.hasOwn(entries, uniqueName)) {
    uniqueName = name.replace(/\.docx$/, `（${duplicate++}）.docx`);
  }
  entries[uniqueName] = bytes;
}

/** 一次转换整批，再恢复业务文件名；批次即使只有一份，也交付 ZIP。 */
export async function prepareInvitationDownload(
  entries: Record<string, Uint8Array>,
  format: InvitationDownloadFormat,
  batchFileName?: string,
  signal?: AbortSignal,
) {
  const names = Object.keys(entries);
  const documents = Object.values(entries);
  const files =
    format === "pdf"
      ? await convertInvitationPdfs(documents.map(prepareDocxForPdf), {
          signal,
        })
      : documents;
  const outputNames = names.map((name) =>
    format === "pdf" ? name.replace(/\.docx$/, ".pdf") : name,
  );
  if (
    files.reduce((total, file) => total + file.byteLength, 0) >
    INVITATION_DOWNLOAD_MAX_BYTES
  ) {
    throw new InvitationPdfError("本次下载超过 500 MB，请缩小范围分批下载");
  }
  if (batchFileName) {
    const bytes = zipSync(
      Object.fromEntries(
        files.map((file, index) => [outputNames[index], file]),
      ),
      { level: 0 },
    );
    if (bytes.byteLength > INVITATION_DOWNLOAD_MAX_BYTES) {
      throw new InvitationPdfError("本次下载超过 500 MB，请缩小范围分批下载");
    }
    return { bytes, fileName: batchFileName, mime: "application/zip" };
  }
  const bytes = files[0];
  const fileName = outputNames[0];
  if (!bytes || !fileName) throw new InvitationPdfError("没有可下载的邀请函");
  return {
    bytes,
    fileName,
    mime: format === "pdf" ? "application/pdf" : DOCX_MIME,
  };
}
