import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isFrameworkSourcePath } from "#veryfront/platform/compat/framework-source-resolver.ts";
import type { LocalImport, MissingImport } from "#veryfront/transforms/esm/import-parser.ts";
import { IMPORT_RESOLUTION_ERROR } from "#veryfront/errors";

const MAX_PREFLIGHT_IMPORTS = 5_000;

interface PreflightImportsResult {
  validImports: LocalImport[];
  missingImports: MissingImport[];
}

export async function preflightLocalImports(
  imports: LocalImport[],
  filePath: string,
  fs: { stat: (path: string) => Promise<{ isFile: boolean }> } = createFileSystem(),
): Promise<PreflightImportsResult> {
  if (imports.length > MAX_PREFLIGHT_IMPORTS) {
    throw IMPORT_RESOLUTION_ERROR.create({
      detail: `Module exceeds the import limit of ${MAX_PREFLIGHT_IMPORTS}`,
    });
  }
  const validImports: LocalImport[] = [];
  const missingImports: MissingImport[] = [];
  const localFs = createFileSystem();
  const statResults = new Map<string, Promise<boolean>>();

  for (const imp of imports) {
    if (!imp.absolutePath.startsWith("/")) {
      validImports.push(imp);
      continue;
    }

    const statFs = isFrameworkSourcePath(imp.absolutePath) ? localFs : fs;

    try {
      let statResult = statResults.get(imp.absolutePath);
      if (!statResult) {
        statResult = statFs.stat(imp.absolutePath).then((stat) => stat.isFile);
        statResults.set(imp.absolutePath, statResult);
      }
      if (await statResult) {
        validImports.push(imp);
      } else {
        missingImports.push({
          specifier: imp.specifier,
          fromFile: filePath,
          reason: "Pre-flight: dependency is not a file on disk",
        });
      }
    } catch (_) {
      /* expected: file may not be accessible on disk */
      missingImports.push({
        specifier: imp.specifier,
        fromFile: filePath,
        reason: "Pre-flight: dependency is not accessible",
      });
    }
  }

  return { validImports, missingImports };
}
