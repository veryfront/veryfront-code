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
import { isFrameworkSourcePath } from "#veryfront/platform/compat/framework-source-resolver.ts";
import { isAbsolute, normalize, relative } from "#veryfront/compat/path/index.ts";
import { DEPENDENCY_MISSING, IMPORT_RESOLUTION_ERROR } from "#veryfront/errors";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  MAX_SSR_IMPORTS_PER_MODULE,
  MAX_TRANSFORM_DEPTH,
  TRANSFORM_BATCH_SIZE,
} from "./constants.ts";
import { globalModuleCache } from "./cache/index.ts";
import {
  createDependencyHashCache,
  type DependencyHashCache,
} from "#veryfront/cache/dependency-graph.ts";
import { stripUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { isCrossProjectUnavailableError } from "./cross-project-import-loader.ts";

const logger = rendererLogger.component("ssr-module-loader");
const MAX_MISSING_DEPENDENCIES = 100;
const MAX_LOCAL_DEPENDENCY_SOURCE_BYTES = 5 * 1024 * 1024;

function safeSpecifier(value: string): string {
  const sanitized = stripUnsafeControlCharacters(value)
    .replaceAll("\t", "")
    .replaceAll("\n", "")
    .replaceAll("\r", "");
  return sanitized.length <= 256 ? sanitized : `${sanitized.slice(0, 253)}...`;
}

/**
 * Manages dependency validation for SSR module loading:
 * - Pre-flight checks for local file existence
 * - Recursive dependency resolution
 * - Missing dependency collection and error reporting
 */
export class SSRDependencyValidator {
  /** Accumulated missing dependencies across the transform tree. */
  private collectedMissingDependencies: MissingImport[] = [];

  get missingDependencies(): readonly MissingImport[] {
    return this.collectedMissingDependencies;
  }

  constructor(
    private getCacheKey: (filePath: string) => string,
    private transformWithDependencies: (
      filePath: string,
      source: string | undefined,
      depth: number,
      dependencyHashCache: DependencyHashCache,
      ancestry: ReadonlySet<string>,
    ) => Promise<void>,
    private transformCrossProjectImport: (
      crossProjectImport: CrossProjectImport,
    ) => Promise<string>,
    private adapter: RuntimeAdapter,
    private projectDir: string,
  ) {}

  /** Reset missing dependencies for a new load cycle. */
  reset(): void {
    this.collectedMissingDependencies = [];
  }

  /** Add bounded missing-dependency records for the current load cycle. */
  addMissingDependencies(...missing: MissingImport[]): void {
    const remaining = MAX_MISSING_DEPENDENCIES - this.collectedMissingDependencies.length;
    if (remaining <= 0) return;
    this.collectedMissingDependencies.push(...missing.slice(0, remaining));
  }

  /**
   * Throw a structured error with all accumulated missing dependencies.
   */
  throwMissingDependencies(_filePath: string): never {
    const missingList = this.collectedMissingDependencies
      .slice(0, 20)
      .map((missing) => `  - ${safeSpecifier(missing.specifier)}`)
      .join("\n");
    const omitted = this.collectedMissingDependencies.length - 20;
    const omittedSuffix = omitted > 0 ? `\n  - and ${omitted} more` : "";

    logger.error("Missing dependencies detected", {
      missing: this.collectedMissingDependencies.length,
    });

    throw DEPENDENCY_MISSING.create({
      detail: `Component has missing dependencies:\n${missingList}${omittedSuffix}`,
      context: {
        phase: "dependency-resolution",
        missingCount: this.collectedMissingDependencies.length,
      },
    });
  }

  /**
   * Ensure all dependencies of a cached module exist by recursively
   * processing local imports and cross-project imports.
   */
  async ensureDependenciesExist(
    code: string,
    filePath: string,
    depth: number = 0,
    ancestry: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    if (depth > MAX_TRANSFORM_DEPTH) {
      throw IMPORT_RESOLUTION_ERROR.create({
        detail: `Module dependency graph exceeds the maximum depth of ${MAX_TRANSFORM_DEPTH}`,
      });
    }

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
      this.addMissingDependencies(...parseResult.missing);
    }

    if (
      parseResult.imports.length + parseResult.cssImports.length +
          parseResult.crossProjectImports.length + parseResult.missing.length >
        MAX_SSR_IMPORTS_PER_MODULE
    ) {
      throw IMPORT_RESOLUTION_ERROR.create({
        detail: `Module exceeds the import limit of ${MAX_SSR_IMPORTS_PER_MODULE}`,
      });
    }

    const localFs = createFileSystem();
    await this.processLocalImports(
      parseResult.imports,
      filePath,
      depth,
      localFs,
      createDependencyHashCache(),
      ancestry,
    );

    for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (crossImport) => {
          try {
            await this.transformCrossProjectImport(crossImport);
          } catch (error) {
            if (!isCrossProjectUnavailableError(error)) throw error;
            this.addMissingDependencies({
              specifier: crossImport.specifier,
              fromFile: filePath,
              reason: "Cross-project import could not be loaded",
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
    dependencyHashCache: DependencyHashCache,
    ancestry: ReadonlySet<string> = new Set(),
  ): Promise<Map<string, string>> {
    if (imports.length > MAX_SSR_IMPORTS_PER_MODULE) {
      throw IMPORT_RESOLUTION_ERROR.create({
        detail: `Module exceeds the import limit of ${MAX_SSR_IMPORTS_PER_MODULE}`,
      });
    }
    const importPathMap = new Map<string, string>();

    for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = imports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (imp) => {
          let depSource: string;
          try {
            depSource = await this.readLocalImportSource(imp.absolutePath, localFs);
          } catch {
            this.addMissingDependencies({
              specifier: imp.specifier,
              fromFile: fromFilePath,
              reason: "Local import could not be loaded",
            });
            return;
          }

          await this.transformWithDependencies(
            imp.absolutePath,
            depSource,
            depth + 1,
            dependencyHashCache,
            ancestry,
          );

          const depCacheKey = this.getCacheKey(imp.absolutePath);
          const depEntry = globalModuleCache.get(depCacheKey);
          if (!depEntry) {
            this.addMissingDependencies({
              specifier: imp.specifier,
              fromFile: fromFilePath,
              reason: "Transformed dependency is unavailable",
            });
            return;
          }

          importPathMap.set(imp.specifier, depEntry.tempPath);
          importPathMap.set(imp.absolutePath, depEntry.tempPath);
        }),
      );
    }

    return importPathMap;
  }

  private isProjectAbsolutePath(path: string): boolean {
    const projectRelativePath = relative(normalize(this.projectDir), normalize(path));
    return projectRelativePath === "" ||
      (projectRelativePath !== ".." &&
        !projectRelativePath.startsWith("../") &&
        !projectRelativePath.startsWith("..\\") &&
        !isAbsolute(projectRelativePath));
  }

  private async readLocalImportSource(
    path: string,
    localFs: ReturnType<typeof createFileSystem>,
  ): Promise<string> {
    let source: string;
    if (!isAbsolute(path)) {
      source = await this.adapter.fs.readFile(path);
    } else if (this.isProjectAbsolutePath(path)) {
      source = await this.adapter.fs.readFile(path);
    } else if (isFrameworkSourcePath(path)) {
      source = await localFs.readTextFile(path);
    } else {
      throw IMPORT_RESOLUTION_ERROR.create({
        detail: "Local dependency must stay inside the project root",
      });
    }

    if (new TextEncoder().encode(source).byteLength > MAX_LOCAL_DEPENDENCY_SOURCE_BYTES) {
      throw new RangeError("Local dependency source exceeds size limit");
    }
    return source;
  }
}
