import { serverLogger } from "#veryfront/utils/logger/logger.ts";

function cleanupExtractedEsbuildBinary(targetPath: string, extractionDir: string): void {
  for (const path of [targetPath, extractionDir]) {
    try {
      Deno.removeSync(path);
    } catch (cleanupError) {
      if (cleanupError instanceof Deno.errors.NotFound) continue;
      serverLogger.warn("[esbuild] Failed to clean up extracted binary", {
        extractionDir,
        path,
        cleanupError,
      });
    }
  }
}

/** Retire the compiled Deno process's private extraction on natural or explicit exit. */
export function registerExtractedEsbuildCleanup(targetPath: string, extractionDir: string): void {
  addEventListener("unload", () => cleanupExtractedEsbuildBinary(targetPath, extractionDir), {
    once: true,
  });
}
