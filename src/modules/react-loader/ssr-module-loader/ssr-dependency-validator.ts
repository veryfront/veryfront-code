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
import { registerCSSImport } from "../css-import-collector.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED, createError, toError, VeryfrontError } from "#veryfront/errors";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { MAX_TRANSFORM_DEPTH, TRANSFORM_BATCH_SIZE } from "./constants.ts";
import type { ModuleCacheEntry } from "./types.ts";
import {
  createDependencyHashCache,
  type DependencyHashCache,
} from "#veryfront/cache/dependency-graph.ts";

const logger = rendererLogger.component("ssr-module-loader");

function isTerminalHttpModuleFetchFailure(error: unknown): error is VeryfrontError {
  if (!(error instanceof VeryfrontError) || error.slug !== BUILD_FAILED.slug) return false;
  const context = error.context;
  return typeof context === "object" && context !== null &&
    (context as { phase?: unknown }).phase === "http-module-fetch";
}

/**
 * Pick the rejection a settled dependency batch should propagate.
 *
 * Both batch loops catch everything except a terminal HTTP module fetch
 * failure, so today every rejection is that failure. Select on the predicate
 * rather than on "first rejection" so a throw added outside either try block
 * later cannot be mistaken for the terminal failure — and fall back to the
 * first rejection so such a throw is still propagated rather than dropped.
 */
function selectPropagatedFailure(
  results: PromiseSettledResult<unknown>[],
): PromiseRejectedResult | undefined {
  const rejections = results.filter((result): result is PromiseRejectedResult =>
    result.status === "rejected"
  );
  return rejections.find((rejection) => isTerminalHttpModuleFetchFailure(rejection.reason)) ??
    rejections[0];
}

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
    private transformWithDependencies: (
      filePath: string,
      source: string | undefined,
      depth: number,
      dependencyHashCache: DependencyHashCache,
    ) => Promise<ModuleCacheEntry>,
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

    logger.error("Missing dependencies detected", {
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

    // Register CSS imports from cached modules for HTML inclusion
    for (const cssImport of parseResult.cssImports) {
      registerCSSImport(cssImport.absolutePath);
    }

    if (parseResult.missing.length > 0) {
      this.missingDependencies.push(...parseResult.missing);
    }

    const localFs = createFileSystem();
    await this.processLocalImports(
      parseResult.imports,
      filePath,
      depth,
      localFs,
      createDependencyHashCache(),
    );

    await this.processCrossProjectImports(parseResult.crossProjectImports, filePath);
  }

  /**
   * Process cross-project imports in batches, building a map of
   * specifier -> temp file path.
   *
   * Non-terminal failures are aggregated into {@link missingDependencies} so the
   * caller can report every unresolved specifier at once. A terminal HTTP module
   * fetch failure is rethrown untouched instead: it means the source could not be
   * retrieved at all, so reporting it as a missing dependency would mislabel a
   * transient network failure as a broken component.
   */
  async processCrossProjectImports(
    crossProjectImports: CrossProjectImport[],
    filePath: string,
  ): Promise<Map<string, string>> {
    const crossProjectPaths = new Map<string, string>();

    for (let i = 0; i < crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (crossImport) => {
          try {
            const tempPath = await this.transformCrossProjectImport(crossImport);
            crossProjectPaths.set(crossImport.specifier, tempPath);
          } catch (error) {
            if (isTerminalHttpModuleFetchFailure(error)) throw error;
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
      const failure = selectPropagatedFailure(results);
      if (failure) throw failure.reason;
    }

    return crossProjectPaths;
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
    dependencyHashCache: DependencyHashCache,
  ): Promise<Map<string, string>> {
    const importPathMap = new Map<string, string>();

    for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = imports.slice(i, i + TRANSFORM_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (imp) => {
          try {
            const depSource = await this.readLocalImportSource(imp.absolutePath, localFs);

            const depEntry = await this.transformWithDependencies(
              imp.absolutePath,
              depSource,
              depth + 1,
              dependencyHashCache,
            );

            importPathMap.set(imp.specifier, depEntry.tempPath);
            importPathMap.set(imp.absolutePath, depEntry.tempPath);
          } catch (error) {
            if (isTerminalHttpModuleFetchFailure(error)) throw error;
            this.missingDependencies.push({
              specifier: imp.specifier,
              fromFile: fromFilePath,
              reason: `Failed to load dependency: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
      );
      const failure = selectPropagatedFailure(results);
      if (failure) throw failure.reason;
    }

    return importPathMap;
  }

  private isProjectAbsolutePath(path: string): boolean {
    const projectDir = this.projectDir.replace(/\/+$/, "");
    if (!projectDir || projectDir === "/") return false;
    return path === projectDir || path.startsWith(`${projectDir}/`);
  }

  private readLocalImportSource(
    path: string,
    localFs: ReturnType<typeof createFileSystem>,
  ): Promise<string> {
    if (!path.startsWith("/")) {
      return this.adapter.fs.readFile(path);
    }

    if (this.isProjectAbsolutePath(path)) {
      return this.adapter.fs.readFile(path);
    }

    return localFs.readTextFile(path);
  }
}
