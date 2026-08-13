import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileStorageDir } from "./file-config";

const isMissingFileError = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT";

const storagePath = (storageKey: string) => {
  const path = resolve(fileStorageDir, storageKey);
  const pathFromRoot = relative(fileStorageDir, path);

  if (
    !pathFromRoot ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error("Invalid file storage key");
  }

  return path;
};

export const createStorageKey = (fileId: string, date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}/${fileId}`;
};

export const fileStorage = {
  async write(storageKey: string, content: Uint8Array) {
    const finalPath = storagePath(storageKey);
    const temporaryPath = `${finalPath}.uploading-${randomUUID()}`;

    await mkdir(dirname(finalPath), { recursive: true });

    try {
      await writeFile(temporaryPath, content);
      await rename(temporaryPath, finalPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  },

  async remove(storageKey: string) {
    try {
      await unlink(storagePath(storageKey));
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  },

  async open(storageKey: string) {
    const path = storagePath(storageKey);

    try {
      const fileStats = await stat(path);
      return {
        body: Readable.toWeb(
          createReadStream(path),
        ) as unknown as ReadableStream<Uint8Array<ArrayBuffer>>,
        sizeBytes: fileStats.size,
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  },
};
