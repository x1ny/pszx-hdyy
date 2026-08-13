import { resolve } from "node:path";

const DEFAULT_FILE_STORAGE_DIR = "./data/files";
const DEFAULT_FILE_MAX_SIZE_BYTES = 50 * 1024 * 1024;

const parsePositiveInteger = (
  name: string,
  value: string | undefined,
  fallback: number,
) => {
  const raw = value?.trim() || String(fallback);
  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }

  return parsed;
};

/** Relative paths are resolved from the server process working directory. */
export const fileStorageDir = resolve(
  process.env.FILE_STORAGE_DIR?.trim() || DEFAULT_FILE_STORAGE_DIR,
);

export const fileMaxSizeBytes = parsePositiveInteger(
  "FILE_MAX_SIZE_BYTES",
  process.env.FILE_MAX_SIZE_BYTES,
  DEFAULT_FILE_MAX_SIZE_BYTES,
);
