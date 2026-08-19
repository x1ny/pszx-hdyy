import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../infra/db";
import { createStorageKey, fileStorage } from "../../infra/file-storage";
import { fileAsset } from "./schema";

export const filePublicFields = {
  id: fileAsset.id,
  originalName: fileAsset.originalName,
  mimeType: fileAsset.mimeType,
  sizeBytes: fileAsset.sizeBytes,
  status: fileAsset.status,
  createdAt: fileAsset.createdAt,
};

const fileRecordFields = {
  ...filePublicFields,
  storageKey: fileAsset.storageKey,
};

const normalizeFileName = (name: string) => {
  const nameWithoutPath = name.split(/[\\/]/).at(-1)?.trim() || "file";
  return nameWithoutPath.slice(0, 255);
};

const normalizeMimeType = (mimeType: string) => {
  const normalized = mimeType.trim().toLowerCase();
  return /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(normalized)
    ? normalized
    : "application/octet-stream";
};

export async function storeUploadedFile(file: File) {
  const fileId = randomUUID();
  const storageKey = createStorageKey(fileId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await db.insert(fileAsset).values({
    id: fileId,
    storageKey,
    originalName: normalizeFileName(file.name),
    mimeType: normalizeMimeType(file.type),
    sizeBytes: 0,
    sha256: "",
    status: "uploading",
  });

  try {
    await fileStorage.write(storageKey, bytes);

    const [row] = await db
      .update(fileAsset)
      .set({
        sizeBytes: bytes.byteLength,
        sha256,
        status: "ready",
      })
      .where(eq(fileAsset.id, fileId))
      .returning(filePublicFields);

    if (!row) {
      throw new Error("Uploaded file record disappeared");
    }

    return row;
  } catch (error) {
    await fileStorage.remove(storageKey).catch(() => undefined);
    await db
      .update(fileAsset)
      .set({ status: "failed" })
      .where(eq(fileAsset.id, fileId))
      .catch(() => undefined);
    throw error;
  }
}

export async function findFileForRead(fileId: string) {
  const [row] = await db
    .select(fileRecordFields)
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));

  if (!row || row.status !== "ready") {
    return null;
  }

  const content = await fileStorage.open(row.storageKey);
  return content ? { file: row, content } : null;
}

/**
 * 读出整份文件内容。
 *
 * `findFileForRead` 返回的是流（HTTP 下载直接透传，不占内存）；需要在服务端
 * **处理**文件内容的模块（邀请函按 docx 模板渲染）拿不了流，得要完整字节。
 * 放在这里而不是让调用方自己 collect：storageKey 到字节的转换属于 file 模块
 * 的职责，外面不该知道存储是本地磁盘还是别的什么。
 */
export async function readFileBytes(fileId: string) {
  const found = await findFileForRead(fileId);
  if (!found) return null;

  return {
    file: found.file,
    bytes: new Uint8Array(await new Response(found.content.body).arrayBuffer()),
  };
}
