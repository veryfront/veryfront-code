/**
 * SSR Dependency Validator
 *
 * Validates and processes local and cross-project dependencies for SSR modules.
 * Handles pre-flight checks, recursive dependency resolution, and missing dependency reporting.
 *
 * @module module-system/react-loader/ssr-module-loader/ssr-dependency-validator
 */

import type { CrossProjectImport, MissingImport } from "#veryfront/transforms/esm/import-parser.ts";
import { parseLocalImports } from "#veryfront/transforms/esm/import-parser.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { MAX_TRANSFORM_DEPTH, TRANSFORM_BATCH_SIZE } from "./constants.ts";
import { globalModuleCache } from "./cache/index.ts";

const log = logger.component("ssr-module-loader");

/**
 * Manages dependency validation for SSR module loading:
 * - Pre-flight checks for local file existence
 * - Recursive dependency resolution
 * - Missing dependency collection and error reporting
 */
export class SSRDependencyValidator {
  /** Accumulated missing dependencies across the transform tree. */
  missingDependencies: MissingImport[] = [];

  constructor(
    private getCacheKey: (filePath: string) => string,
    private transformWithDependencies: (
      filePath: string,
      source: string | undefined,
      depth: number,
    ) => Promise<void>,
    private transformCrossProjectImport: (
      crossProjectImport: CrossProjectImport,
    ) => Promise<string>,
    private adapter: RuntimeAdapter,
    private projectDir: string,
  ) {}

  /** Reset missing dependencies for a new load cycle. */
  reset(): void {
    this.missingDependencies = [];
  }

  /**
   * Throw a structured error with all accumulated missing dependencies.
   */
  throwMissingDependencies(filePath: string): never {
    const missingList = this.missingDependencies
      .map((m) => `  - ${m.specifier} (from ${m.fromFile.slice(-40)}): ${m.reason}`)
      .join("\n");

    log.error("Missing dependencies detected", {
      file: filePath.slice(-60),
      missing: this.missingDependencies.length,
      details: this.missingDependencies,
    });

    throw toError(
      createError({
        type: "build",
        message: `Component has missing dependencies:\n${missingList}`,
        context: {
          file: filePath,
          phase: "dependency-resolution",
          missing: this.missingDependencies,
        },
      }),
    );
  }

  /**
   * Ensure all dependencies of a cached module exist by recursively
   * processing local imports and cross-project imports.
   */
  async ensureDependenciesExist(
    code: string,
    filePath: string,
    depth: number = 0,
  ): Promise<void> {
    if (depth > MAX_TRANSFORM_DEPTH) return;

    const parseResult = await parseLocalImports(
      code,
      filePath,
      this.projectDir,
      this.adapter,
    );

    if (parseResult.missing.length > 0) {
      this.missingDependencies.push(...parseResult.missing);
    }

    const localFs = createFileSystem();
    await this.processLocalImports(parseResult.imports, filePath, depth, localFs);

    for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (crossImport) => {
          try {
            await this.transformCrossProjectImport(crossImport);
          } catch (error) {
            this.missingDependencies.push({
              specifier: crossImport.specifier,
              fromFile: filePath,
              reason: `Failed to fetch cross-project import: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );
    }
  }

  /**
   * Process local imports in batches, recursively transforming dependencies
   * and building a map of specifier -> temp file path.
   */
  async processLocalImports(
    imports: Array<{ absolutePath: string; specifier: string }>,
    fromFilePath: string,
    depth: number,
    localFs: ReturnType<typeof createFileSystem>,
  ): Promise<Map<string, string>> {
    const importPathMap = new Map<string, string>();

    for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = imports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (imp) => {
          try {
            const depSource = imp.absolutePath.startsWith("/")
              ? await localFs.readTextFile(imp.absolutePath)
              : await this.adapter.fs.readFile(imp.absolutePath);

            await this.transformWithDependencies(imp.absolutePath, depSource, depth + 1);

            const depCacheKey = this.getCacheKey(imp.absolutePath);
            const depEntry = globalModuleCache.get(depCacheKey);
            if (depEntry) {
              importPathMap.set(imp.specifier, depEntry.tempPath);
              importPathMap.set(imp.absolutePath, depEntry.tempPath);
            }
          } catch (error) {
            this.missingDependencies.push({
              specifier: imp.specifier,
              fromFile: fromFilePath,
              reason: `Failed to read file: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );
    }

    return importPathMap;
  }
}
