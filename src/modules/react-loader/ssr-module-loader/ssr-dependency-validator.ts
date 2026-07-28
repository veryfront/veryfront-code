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
import { createError, toError } from "#veryfront/errors";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { MAX_TRANSFORM_DEPTH, TRANSFORM_BATCH_SIZE } from "./constants.ts";
import {
  createDependencyHashCache,
  type DependencyHashCache,
} from "#veryfront/cache/dependency-graph.ts";
import type { ModuleCacheEntry } from "./types.ts";

const logger = rendererLogger.component("ssr-module-loader");
const MAX_MISSING_DEPENDENCIES = 100;
const MAX_MISSING_FIELD_LENGTH = 4_096;
const MISSING_DEPENDENCY_ERROR = Symbol("veryfront.ssr.missing-dependencies");

interface MissingDependencyFailure {
  readonly missing: readonly MissingImport[];
  readonly omitted: number;
}

type MarkedMissingDependencyError = Error & {
  readonly [MISSING_DEPENDENCY_ERROR]: MissingDependencyFailure;
};

function truncateMissingField(value: string): string {
  if (value.length <= MAX_MISSING_FIELD_LENGTH) return value;
  return `${value.slice(0, MAX_MISSING_FIELD_LENGTH - 1)}…`;
}

function normalizeMissingDependency(missing: MissingImport): MissingImport {
  return Object.freeze({
    specifier: truncateMissingField(missing.specifier),
    fromFile: truncateMissingField(missing.fromFile),
    reason: truncateMissingField(missing.reason),
  });
}

function getMissingDependencyFailure(
  error: unknown,
): MissingDependencyFailure | null {
  if (
    !(error instanceof Error) ||
    !Object.prototype.hasOwnProperty.call(error, MISSING_DEPENDENCY_ERROR)
  ) {
    return null;
  }
  return (error as MarkedMissingDependencyError)[MISSING_DEPENDENCY_ERROR];
}

/**
 * Manages dependency validation for SSR module loading:
 * - Pre-flight checks for local file existence
 * - Recursive dependency resolution
 * - Missing dependency collection and error reporting
 */
export class SSRDependencyValidator {
  private readonly collectedMissingDependencies: MissingImport[] = [];
  private readonly missingDependencyKeys = new Set<string>();
  private mergedFailures = new WeakSet<MissingDependencyFailure>();
  private omittedMissingDependencies = 0;

  constructor(
    private transformWithDependencies: (
      filePath: string,
      source: string | undefined,
      depth: number,
      dependencyHashCache: DependencyHashCache,
      ancestry: readonly string[],
    ) => Promise<ModuleCacheEntry>,
    private transformCrossProjectImport: (
      crossProjectImport: CrossProjectImport,
    ) => Promise<string>,
    private adapter: RuntimeAdapter,
    private projectDir: string,
  ) {}

  get missingDependencies(): readonly MissingImport[] {
    return this.collectedMissingDependencies;
  }

  get missingDependencyCount(): number {
    return this.collectedMissingDependencies.length +
      this.omittedMissingDependencies;
  }

  get hasMissingDependencies(): boolean {
    return this.missingDependencyCount > 0;
  }

  /** Reset missing dependencies for a new load cycle. */
  reset(): void {
    this.collectedMissingDependencies.length = 0;
    this.missingDependencyKeys.clear();
    this.mergedFailures = new WeakSet();
    this.omittedMissingDependencies = 0;
  }

  addMissingDependency(missing: MissingImport): void {
    const normalized = normalizeMissingDependency(missing);
    const key = JSON.stringify([
      normalized.specifier,
      normalized.fromFile,
      normalized.reason,
    ]);
    if (this.missingDependencyKeys.has(key)) return;
    this.missingDependencyKeys.add(key);

    if (
      this.collectedMissingDependencies.length >= MAX_MISSING_DEPENDENCIES
    ) {
      this.omittedMissingDependencies++;
      return;
    }
    this.collectedMissingDependencies.push(normalized);
  }

  addMissingDependencies(missing: readonly MissingImport[]): void {
    for (const entry of missing) this.addMissingDependency(entry);
  }

  /**
   * Merge a dependency failure produced by another singleflight leader.
   * Returns false for unrelated transform errors, which must remain fatal.
   */
  mergeMissingDependencyError(error: unknown): boolean {
    const failure = getMissingDependencyFailure(error);
    if (!failure) return false;
    if (this.mergedFailures.has(failure)) return true;

    this.mergedFailures.add(failure);
    this.addMissingDependencies(failure.missing);
    this.omittedMissingDependencies += failure.omitted;
    return true;
  }

  /**
   * Throw a structured error with all accumulated missing dependencies.
   */
  throwMissingDependencies(filePath: string): never {
    const missingList = this.collectedMissingDependencies
      .map((m) => `  - ${m.specifier} (from ${m.fromFile.slice(-40)}): ${m.reason}`)
      .concat(
        this.omittedMissingDependencies > 0
          ? [`  - … ${this.omittedMissingDependencies} additional dependencies omitted`]
          : [],
      )
      .join("\n");

    logger.error("Missing dependencies detected", {
      file: filePath.slice(-60),
      missing: this.missingDependencyCount,
      details: this.collectedMissingDependencies,
      omitted: this.omittedMissingDependencies,
    });

    const error = toError(
      createError({
        type: "build",
        message: `Component has missing dependencies:\n${missingList}`,
        context: {
          file: filePath,
          phase: "dependency-resolution",
          missing: [...this.collectedMissingDependencies],
        },
      }),
    );
    const failure = Object.freeze({
      missing: Object.freeze([...this.collectedMissingDependencies]),
      omitted: this.omittedMissingDependencies,
    });
    this.mergedFailures.add(failure);
    Object.defineProperty(error, MISSING_DEPENDENCY_ERROR, {
      configurable: false,
      enumerable: false,
      value: failure,
      writable: false,
    });
    throw error;
  }

  /**
   * Ensure all dependencies of a cached module exist by recursively
   * processing local imports and cross-project imports.
   */
  async ensureDependenciesExist(
    code: string,
    filePath: string,
    depth: number = 0,
    dependencyHashCache: DependencyHashCache = createDependencyHashCache(),
    ancestry: readonly string[] = [],
  ): Promise<void> {
    if (depth > MAX_TRANSFORM_DEPTH) {
      throw new Error(
        `Max transform depth exceeded while validating dependencies for ${filePath}`,
      );
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
      this.addMissingDependencies(parseResult.missing);
    }

    const localFs = createFileSystem();
    await this.processLocalImports(
      parseResult.imports,
      filePath,
      depth,
      localFs,
      dependencyHashCache,
      ancestry,
    );

    for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
      await Promise.all(
        batch.map(async (crossImport) => {
          try {
            await this.transformCrossProjectImport(crossImport);
          } catch (error) {
            this.addMissingDependency({
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
    dependencyHashCache: DependencyHashCache,
    ancestry: readonly string[] = [],
  ): Promise<Map<string, string>> {
    const importPathMap = new Map<string, string>();

    for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
      const batch = imports.slice(i, i + TRANSFORM_BATCH_SIZE);
      const failures = await Promise.all(
        batch.map(async (imp) => {
          let depSource: string;
          try {
            depSource = await this.readLocalImportSource(
              imp.absolutePath,
              localFs,
            );
          } catch (error) {
            this.addMissingDependency({
              specifier: imp.specifier,
              fromFile: fromFilePath,
              reason: `Failed to read file: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
            return null;
          }

          try {
            const depEntry = await this.transformWithDependencies(
              imp.absolutePath,
              depSource,
              depth + 1,
              dependencyHashCache,
              ancestry,
            );

            importPathMap.set(imp.specifier, depEntry.tempPath);
            importPathMap.set(imp.absolutePath, depEntry.tempPath);
            return null;
          } catch (error) {
            if (this.mergeMissingDependencyError(error)) return null;
            return error instanceof Error ? error : new Error(String(error));
          }
        }),
      );
      const fatalFailure = failures.find(
        (failure): failure is Error => failure instanceof Error,
      );
      if (fatalFailure) throw fatalFailure;
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
