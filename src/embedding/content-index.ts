import { computeHash } from "#veryfront/utils";
import { resolveChunkOptions } from "./chunk.ts";
import type { RagStoreConfig } from "./types.ts";

export const CONTENT_INDEX_MANAGED_BY = "content-dir";

/**
 * Builds a stable identity for every input that changes generated document
 * chunks or vectors. Raw content is represented by its SHA-256 digest so the
 * fingerprint payload stays small even for large source files.
 */
export function computeContentIndexFingerprint(
  contentHash: string,
  config: Pick<RagStoreConfig, "chunkOptions" | "documentPrefix" | "model"> & {
    model: string;
  },
): Promise<string> {
  const chunkOptions = resolveChunkOptions(config.chunkOptions);
  return computeHash(JSON.stringify([
    "veryfront-rag-content-index-v1",
    contentHash,
    config.model,
    config.documentPrefix ?? "",
    chunkOptions.maxChars,
    chunkOptions.overlap,
    chunkOptions.maxChunks,
    chunkOptions.separators,
  ]));
}

export function normalizeContentRoot(contentDir: string): string {
  return contentDir.replace(/[\\/]+$/, "") || contentDir;
}

export function contentTitle(contentRoot: string, filePath: string): string {
  const relative = filePath.startsWith(contentRoot + "/")
    ? filePath.slice(contentRoot.length + 1)
    : filePath.startsWith(contentRoot + "\\")
    ? filePath.slice(contentRoot.length + 1)
    : filePath;
  return relative.replace(/\.[^.]+$/, "");
}
