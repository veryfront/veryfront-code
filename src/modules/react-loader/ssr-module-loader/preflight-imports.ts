import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isFrameworkSourcePath } from "#veryfront/platform/compat/framework-source-resolver.ts";
import type { LocalImport, MissingImport } from "#veryfront/transforms/esm/import-parser.ts";

interface PreflightImportsResult {
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
  const localFs = createFileSystem();

  for (const imp of imports) {
    if (!imp.absolutePath.startsWith("/")) {
      validImports.push(imp);
      continue;
    }

    const statFs = isFrameworkSourcePath(imp.absolutePath) ? localFs : fs;

    try {
      const stat = await statFs.stat(imp.absolutePath);
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
