import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { LocalImport, MissingImport } from "#veryfront/transforms/esm/import-parser.ts";

export interface PreflightImportsResult {
  validImports: LocalImport[];
  missingImports: MissingImport[];
}

export async function preflightLocalImports(
  imports: LocalImport[],
  filePath: string,
  fs: { stat: (path: string) => Promise<{ isFile: boolean }> } = createFileSystem(),
): Promise<PreflightImportsResult> {
  const validImports: LocalImport[] = [];
  const missingImports: MissingImport[] = [];

  for (const imp of imports) {
    if (!imp.absolutePath.startsWith("/")) {
      validImports.push(imp);
      continue;
    }

    try {
      const stat = await fs.stat(imp.absolutePath);
      if (stat?.isFile) {
        validImports.push(imp);
      } else {
        missingImports.push({
          specifier: imp.specifier,
          fromFile: filePath,
          reason: `Pre-flight: not a file on disk: ${imp.absolutePath}`,
        });
      }
    } catch (_) {
      /* expected: file may not be accessible on disk */
      missingImports.push({
        specifier: imp.specifier,
        fromFile: filePath,
        reason: `Pre-flight: file not accessible: ${imp.absolutePath}`,
      });
    }
  }

  return { validImports, missingImports };
}
