import { extname } from "#veryfront/platform/compat/path/basic-operations.ts";

export const CHUNKS_PER_FILE = 500;

export type DocumentParts = {
  filePath?: string;
  filePaths?: string[];
  cleanupFilePaths?: string[];
};

export function readPartPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? [
      ...new Set(
        value.filter((path): path is string => typeof path === "string" && path.trim().length > 0),
      ),
    ]
    : [];
}

export function buildChunkFilePaths(filePath: string, chunkCount: number): string[] {
  const extension = extname(filePath);
  const stem = filePath.slice(0, filePath.length - extension.length);
  return Array.from(
    { length: Math.ceil(chunkCount / CHUNKS_PER_FILE) },
    (_, index) => index === 0 ? filePath : `${stem}.part-${index}${extension}`,
  );
}

export function activeDocumentPaths(document: DocumentParts, fallback: string): string[] {
  return document.filePaths?.length
    ? [...new Set(document.filePaths)]
    : [document.filePath ?? fallback];
}

export function retiredDocumentPaths(document: DocumentParts, fallback: string): string[] {
  const active = new Set(activeDocumentPaths(document, fallback));
  return [...new Set(document.cleanupFilePaths ?? [])].filter((path) => !active.has(path));
}

export function documentPartsMetadata(
  activePaths: string[],
  cleanupPaths: string[],
): Record<string, unknown> {
  const filePath = activePaths[0];
  if (!filePath) throw new Error("Document has no file parts");
  const retired = [...new Set(cleanupPaths)].filter((path) => !activePaths.includes(path));
  return {
    filePath,
    ...(activePaths.length > 1 ? { filePaths: activePaths } : {}),
    ...(retired.length ? { cleanupFilePaths: retired } : {}),
  };
}

export function metadataWriteOutcome(
  activePaths: string[],
  observedPaths: string[] | undefined,
  upstreamStatus: unknown,
): "committed" | "rejected" | "unknown" {
  if (!observedPaths) return "unknown";
  const observed = new Set(observedPaths);
  if (
    observed.size === new Set(activePaths).size && activePaths.every((path) => observed.has(path))
  ) return "committed";
  return typeof upstreamStatus === "number" && upstreamStatus >= 400 && upstreamStatus < 500 &&
      upstreamStatus !== 408
    ? "rejected"
    : "unknown";
}

export async function retireDocumentParts(
  paths: readonly string[],
  remove: (path: string) => Promise<void>,
): Promise<Array<{ path: string; error: unknown }>> {
  const failures: Array<{ path: string; error: unknown }> = [];
  for (const path of new Set(paths)) {
    try {
      await remove(path);
    } catch (error) {
      failures.push({ path, error });
    }
  }
  return failures;
}
