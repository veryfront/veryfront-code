import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import type { CSSOptimizationEngine } from "#veryfront/extensions/css/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs, type SecureFs } from "#veryfront/security/secure-fs.ts";
import { DEFAULT_BUILD_CONCURRENCY, logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import {
  type BuildPublicationLock,
  createBuildPublication,
} from "../../production-build/build/build-publication.ts";
import { isContainedAssetPath } from "../../utils/asset-utils.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import {
  CSS_MANIFEST_FILENAME,
  DEFAULT_CSS_OPTIONS,
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_PURGE_PATTERNS,
  MAX_CSS_PURGE_SAFELIST_ENTRIES,
  MAX_CSS_TOTAL_BYTES,
  MAX_CSS_TOTAL_OUTPUT_BYTES,
} from "./constants.ts";
import { CacheManager } from "./css-bundle-cache.ts";
import {
  acquireConfiguredCSSOptimization,
  createCSSOptimizationSession,
  type CSSOptimizationSession,
  validateCSSSourceMap,
} from "./optimization-engine.ts";
import type { CSSPurgingSession } from "./purging-engine.ts";
import { type PurgeContentSource, PurgeStrategy } from "./strategies/purge-strategy.ts";
import type { CSSBundle, CSSOptimizationOptions, CSSOptimizerStats } from "./types/index.ts";
import {
  calculateSavings,
  findCSSFiles,
  getOutputPath,
  globFiles,
  isSafeCSSRelativePath,
} from "./utils.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const encoder = new TextEncoder();

interface PlannedCSSFile {
  sourcePath: string;
  logicalPath: string;
  outputRelativePath: string;
  outputProjectPath: string;
}

export interface CSSOptimizerServiceDependencies {
  optimizationEngine?: CSSOptimizationEngine;
  purgeStrategy?: PurgeStrategy;
  publicationLock?: BuildPublicationLock;
}

type ResolvedCSSOptimizationOptions = Omit<
  Required<CSSOptimizationOptions>,
  "autoprefixer" | "browsers"
>;

function portablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizedCollisionKey(path: string): string {
  return portablePath(path).normalize("NFC").toLocaleLowerCase("en-US");
}

function requireSafeConfiguredPath(path: string, label: string): void {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH_CHARS ||
    hasControlCharacters(path)
  ) {
    throw new TypeError(`${label} must be a safe non-empty path`);
  }
}

function cloneBundles(
  bundles: Map<string, CSSBundle>,
): Map<string, CSSBundle> {
  return new Map(
    [...bundles].map(([key, bundle]) => [key, { ...bundle }]),
  );
}

function assertStringList(
  value: string[],
  label: string,
  maximumEntries: number,
  maximumCharacters = MAX_PATH_LENGTH_CHARS,
  allowEmpty = true,
): void {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximumEntries ||
    value.some((entry) =>
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > maximumCharacters ||
      hasControlCharacters(entry)
    )
  ) {
    throw new TypeError(
      `${label} must be a bounded list of safe non-empty strings`,
    );
  }
}

export class CSSOptimizerService {
  private options: ResolvedCSSOptimizationOptions;
  private cacheManager = new CacheManager();
  private readonly optimizationEngine: CSSOptimizationEngine | undefined;
  private readonly purgeStrategy: PurgeStrategy;
  private readonly publicationLock?: BuildPublicationLock;
  private readonly adapter: RuntimeAdapter;
  private readonly secureFs: SecureFs;
  private readonly baseDir: string;
  private optimization: Promise<Map<string, CSSBundle>> | null = null;

  constructor(
    adapter: RuntimeAdapter,
    baseDir: string,
    options: CSSOptimizationOptions = {},
    dependencies: CSSOptimizerServiceDependencies = {},
  ) {
    if (!adapter || typeof adapter !== "object") {
      throw new TypeError("CSS optimizer requires a runtime adapter");
    }
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new TypeError("CSS optimization options must be an object");
    }
    if (
      typeof dependencies !== "object" ||
      dependencies === null ||
      Array.isArray(dependencies)
    ) {
      throw new TypeError("CSS optimizer dependencies must be an object");
    }
    if (
      dependencies.purgeStrategy !== undefined &&
      (typeof dependencies.purgeStrategy !== "object" ||
        dependencies.purgeStrategy === null ||
        typeof dependencies.purgeStrategy.analyzeContent !== "function" ||
        typeof dependencies.purgeStrategy.process !== "function" ||
        typeof dependencies.purgeStrategy.clearCache !== "function" ||
        typeof dependencies.purgeStrategy.createOperationSession !== "function")
    ) {
      throw new TypeError("CSS purge strategy dependency is invalid");
    }
    if (
      dependencies.publicationLock !== undefined &&
      (typeof dependencies.publicationLock !== "object" ||
        dependencies.publicationLock === null ||
        typeof dependencies.publicationLock.acquire !== "function")
    ) {
      throw new TypeError("CSS publication lock dependency is invalid");
    }
    if (
      Object.hasOwn(options, "autoprefixer") ||
      Object.hasOwn(options, "browsers")
    ) {
      throw new TypeError(
        "CSS autoprefixer/browsers options moved to the optimization extension; configure its browserQueries instead",
      );
    }
    requireSafeConfiguredPath(baseDir, "CSS project directory");
    if (!isAbsolute(baseDir)) {
      throw new TypeError("CSS project directory must be absolute");
    }
    this.baseDir = resolve(baseDir);
    if (options.projectDir !== undefined) {
      requireSafeConfiguredPath(options.projectDir, "CSS projectDir");
      if (!isAbsolute(options.projectDir)) {
        throw new TypeError("CSS projectDir must be absolute");
      }
      if (resolve(options.projectDir) !== this.baseDir) {
        throw new TypeError(
          "CSS projectDir must match the optimizer project boundary",
        );
      }
    }

    for (
      const [name, value] of [
        ["enabled", options.enabled],
        ["minify", options.minify],
        ["purge", options.purge],
        ["criticalCSS", options.criticalCSS],
        ["sourceMap", options.sourceMap],
      ] as const
    ) {
      if (value !== undefined && typeof value !== "boolean") {
        throw new TypeError(`CSS ${name} must be a boolean`);
      }
    }
    if (options.inputFiles !== undefined && !Array.isArray(options.inputFiles)) {
      throw new TypeError("CSS inputFiles must be an array");
    }
    if (
      options.purgeContent !== undefined &&
      !Array.isArray(options.purgeContent)
    ) {
      throw new TypeError("CSS purgeContent must be an array");
    }
    if (
      options.purgeSafelist !== undefined &&
      !Array.isArray(options.purgeSafelist)
    ) {
      throw new TypeError("CSS purgeSafelist must be an array");
    }

    this.options = {
      projectDir: this.baseDir,
      enabled: options.enabled === undefined ? DEFAULT_CSS_OPTIONS.enabled : options.enabled,
      minify: options.minify === undefined ? DEFAULT_CSS_OPTIONS.minify : options.minify,
      purge: options.purge === undefined ? DEFAULT_CSS_OPTIONS.purge : options.purge,
      criticalCSS: options.criticalCSS === undefined
        ? DEFAULT_CSS_OPTIONS.criticalCSS
        : options.criticalCSS,
      inputFiles: options.inputFiles === undefined
        ? [...DEFAULT_CSS_OPTIONS.inputFiles]
        : [...options.inputFiles],
      inputDir: options.inputDir === undefined ? DEFAULT_CSS_OPTIONS.inputDir : options.inputDir,
      outputDir: options.outputDir === undefined
        ? DEFAULT_CSS_OPTIONS.outputDir
        : options.outputDir,
      purgeContent: options.purgeContent === undefined
        ? [...DEFAULT_CSS_OPTIONS.purgeContent]
        : [...options.purgeContent],
      purgeSafelist: options.purgeSafelist === undefined
        ? [...DEFAULT_CSS_OPTIONS.purgeSafelist]
        : [...options.purgeSafelist],
      sourceMap: options.sourceMap === undefined
        ? DEFAULT_CSS_OPTIONS.sourceMap
        : options.sourceMap,
    };
    this.validateConfiguration();
    this.adapter = adapter;
    this.secureFs = createSecureFs({
      baseDir: this.baseDir,
      adapter,
      context: "build",
      validationOptions: { followSymlinks: false },
    });
    this.optimizationEngine = dependencies.optimizationEngine;
    this.purgeStrategy = dependencies.purgeStrategy ??
      new PurgeStrategy({
        baseDir: this.baseDir,
        collectContent: (patterns) => this.collectPurgeContent(patterns),
      });
    this.publicationLock = dependencies.publicationLock;
  }

  private validateConfiguration(): void {
    requireSafeConfiguredPath(this.options.inputDir, "CSS input directory");
    requireSafeConfiguredPath(this.options.outputDir, "CSS output directory");
    assertStringList(
      this.options.inputFiles,
      "CSS inputFiles",
      MAX_CSS_FILES,
    );
    assertStringList(
      this.options.purgeContent,
      "CSS purgeContent",
      MAX_CSS_PURGE_PATTERNS,
      MAX_PATH_LENGTH_CHARS,
      !this.options.purge,
    );
    assertStringList(
      this.options.purgeSafelist,
      "CSS purgeSafelist",
      MAX_CSS_PURGE_SAFELIST_ENTRIES,
    );

    const inputDir = isAbsolute(this.options.inputDir)
      ? resolve(this.options.inputDir)
      : resolve(this.baseDir, this.options.inputDir);
    const outputDir = isAbsolute(this.options.outputDir)
      ? resolve(this.options.outputDir)
      : resolve(this.baseDir, this.options.outputDir);
    if (
      inputDir === this.baseDir ||
      outputDir === this.baseDir ||
      !isContainedAssetPath(this.baseDir, inputDir) ||
      !isContainedAssetPath(this.baseDir, outputDir)
    ) {
      throw new TypeError(
        "CSS input and output directories must be inside the project",
      );
    }
    if (
      isContainedAssetPath(inputDir, outputDir) ||
      isContainedAssetPath(outputDir, inputDir)
    ) {
      throw new TypeError("CSS input and output directories must not overlap");
    }

    this.options.inputDir = inputDir;
    this.options.outputDir = outputDir;
    this.options.inputFiles = this.options.inputFiles.map((path) => {
      requireSafeConfiguredPath(path, "CSS input file");
      const absolutePath = isAbsolute(path) ? resolve(path) : resolve(this.baseDir, path);
      if (
        !isContainedAssetPath(this.baseDir, absolutePath) ||
        isContainedAssetPath(outputDir, absolutePath) ||
        extname(absolutePath).toLowerCase() !== ".css"
      ) {
        throw new TypeError(
          `CSS input file must be a .css file inside the project and outside the output directory: ${path}`,
        );
      }
      return absolutePath;
    });
    if (
      new Set(this.options.inputFiles.map(normalizedCollisionKey)).size !==
        this.options.inputFiles.length
    ) {
      throw new TypeError("CSS inputFiles must not contain duplicate paths");
    }
  }

  async init(): Promise<boolean> {
    if (!this.options.enabled) {
      logger.info("CSS optimization is disabled");
      return false;
    }
    this.createOperationOptimizationSession();
    return true;
  }

  private createOperationOptimizationSession(): CSSOptimizationSession {
    if (this.optimizationEngine !== undefined) {
      return createCSSOptimizationSession(this.optimizationEngine);
    }
    return acquireConfiguredCSSOptimization();
  }

  optimize(): Promise<Map<string, CSSBundle>> {
    const run = this.optimization ??= this.optimizeOnce().finally(() => {
      this.optimization = null;
    });
    return run.then(cloneBundles);
  }

  private optimizeOnce(): Promise<Map<string, CSSBundle>> {
    return withSpan(
      "build.cssOptimizer.optimize",
      async () => {
        if (!this.options.enabled) return new Map();
        if (this.options.criticalCSS) {
          throw new TypeError(
            "criticalCSS cannot run in a batch without HTML; call extractCriticalCSS explicitly",
          );
        }
        if (this.options.purge && this.options.sourceMap) {
          throw new TypeError(
            "CSS source maps cannot be composed safely with purge output",
          );
        }
        const purgingSession = this.options.purge
          ? this.purgeStrategy.createOperationSession()
          : undefined;
        await this.validateFilesystemCapabilities();
        const optimizationSession = this.createOperationOptimizationSession();

        const plans = await this.planFiles();
        if (plans.length === 0) {
          throw new TypeError(
            `CSS optimization found no .css files in ${this.options.inputDir}`,
          );
        }
        if (this.options.purge) {
          await this.purgeStrategy.analyzeContent(this.options.purgeContent);
        } else {
          this.purgeStrategy.clearCache();
        }

        logger.info("Starting CSS optimization", {
          inputDir: this.options.inputDir,
          outputDir: this.options.outputDir,
          files: plans.length,
          minify: this.options.minify,
          purge: this.options.purge,
        });

        const publication = await createBuildPublication(
          this.options.outputDir,
          false,
          { fs: this.adapter.fs, lock: this.publicationLock },
        );
        const stagedCache = new CacheManager();
        let totalInputBytes = 0;
        let totalOutputBytes = 0;
        let failed = false;
        let failure: unknown;
        try {
          await this.secureFs.mkdir(publication.buildDir, {
            recursive: true,
          });
          for (
            let start = 0;
            start < plans.length;
            start += DEFAULT_BUILD_CONCURRENCY
          ) {
            const settled = await Promise.allSettled(
              plans.slice(start, start + DEFAULT_BUILD_CONCURRENCY)
                .map((plan) =>
                  this.optimizeFile(
                    plan,
                    publication.buildDir,
                    optimizationSession,
                    purgingSession,
                  )
                ),
            );
            const errors = settled.flatMap((result) =>
              result.status === "rejected" ? [result.reason] : []
            );
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) {
              throw new AggregateError(
                errors,
                "Multiple CSS files failed optimization",
              );
            }
            for (const result of settled) {
              if (result.status !== "fulfilled") {
                throw new TypeError("Unreachable rejected CSS result");
              }
              totalInputBytes += result.value.size;
              if (totalInputBytes > MAX_CSS_TOTAL_BYTES) {
                throw new TypeError(
                  `CSS inputs exceed ${MAX_CSS_TOTAL_BYTES} actual bytes`,
                );
              }
              totalOutputBytes += result.value.minifiedSize +
                (result.value.sourceMap === undefined
                  ? 0
                  : encoder.encode(result.value.sourceMap).length);
              if (totalOutputBytes > MAX_CSS_TOTAL_OUTPUT_BYTES) {
                throw new TypeError(
                  `CSS outputs exceed ${MAX_CSS_TOTAL_OUTPUT_BYTES} total bytes`,
                );
              }
              stagedCache.addBundle(
                result.value.file,
                result.value,
              );
            }
          }

          await this.secureFs.writeFile(
            join(publication.buildDir, CSS_MANIFEST_FILENAME),
            stagedCache.serializeManifest(),
          );
          await publication.publish();
          this.cacheManager = stagedCache;
        } catch (error) {
          failed = true;
          failure = error;
        }

        try {
          await publication.cleanup();
        } catch (cleanupError) {
          if (failed) {
            throw new AggregateError(
              [failure, cleanupError],
              "CSS optimization failed and staging cleanup also failed",
            );
          }
          throw cleanupError;
        }
        if (failed) throw failure;

        logger.info("CSS optimization complete", {
          totalBundles: this.cacheManager.size(),
          totalSavings: this.cacheManager.getTotalSavings(),
        });
        return this.cacheManager.getAllBundles();
      },
      {
        "build.css.inputDir": this.options.inputDir,
        "build.css.minify": this.options.minify,
      },
    );
  }

  private async validateFilesystemCapabilities(): Promise<void> {
    if (
      typeof this.adapter.fs.rename !== "function" ||
      typeof this.adapter.fs.lstat !== "function"
    ) {
      throw INITIALIZATION_ERROR.create({
        detail: "Transactional CSS optimization requires rename and lstat filesystem support",
      });
    }
    const baseInfo = await this.adapter.fs.lstat(this.baseDir);
    if (!baseInfo.isDirectory || baseInfo.isSymlink) {
      throw new TypeError("CSS project directory must be a real directory");
    }

    if (this.options.inputFiles.length === 0) {
      const inputInfo = await this.adapter.fs.lstat(this.options.inputDir);
      if (!inputInfo.isDirectory || inputInfo.isSymlink) {
        throw new TypeError("CSS input directory must be a real directory");
      }
    }
    await this.secureFs.mkdir(dirname(this.options.outputDir), {
      recursive: true,
    });
    if (await this.adapter.fs.exists(this.options.outputDir)) {
      const outputInfo = await this.adapter.fs.lstat(this.options.outputDir);
      if (!outputInfo.isDirectory || outputInfo.isSymlink) {
        throw new TypeError("CSS output path must be a real directory");
      }
    }
  }

  private async planFiles(): Promise<PlannedCSSFile[]> {
    const sourceFiles = this.options.inputFiles.length > 0
      ? [...this.options.inputFiles].sort(compareStrings)
      : await findCSSFiles(this.options.inputDir, {
        fs: this.secureFs,
        maxFiles: MAX_CSS_FILES,
      });
    const logicalOwners = new Map<string, string>();
    const outputOwners = new Map<string, string>();
    const plans: PlannedCSSFile[] = [];
    let totalBytes = 0;

    for (const sourcePath of sourceFiles) {
      const info = await this.adapter.fs.lstat!(sourcePath);
      if (
        !info.isFile ||
        info.isSymlink ||
        !Number.isSafeInteger(info.size) ||
        info.size < 0
      ) {
        throw new TypeError(`CSS input must be a regular file: ${sourcePath}`);
      }
      if (info.size > MAX_CSS_FILE_BYTES) {
        throw new TypeError(
          `CSS input exceeds ${MAX_CSS_FILE_BYTES} bytes: ${sourcePath}`,
        );
      }
      totalBytes += info.size;
      if (totalBytes > MAX_CSS_TOTAL_BYTES) {
        throw new TypeError(
          `CSS inputs exceed ${MAX_CSS_TOTAL_BYTES} total bytes`,
        );
      }

      const logicalRoot = isContainedAssetPath(
          this.options.inputDir,
          sourcePath,
        )
        ? this.options.inputDir
        : this.baseDir;
      const logicalPath = portablePath(
        relative(logicalRoot, sourcePath),
      ).normalize("NFC");
      if (!isSafeCSSRelativePath(logicalPath)) {
        throw new TypeError(`Unsafe CSS input path: ${sourcePath}`);
      }
      const outputPath = getOutputPath(logicalPath, this.options.outputDir);
      const outputRelativePath = portablePath(
        relative(this.options.outputDir, outputPath),
      ).normalize("NFC");
      const outputProjectPath = portablePath(
        relative(this.baseDir, outputPath),
      ).normalize("NFC");
      if (
        !isSafeCSSRelativePath(outputRelativePath) ||
        !isSafeCSSRelativePath(outputProjectPath)
      ) {
        throw new TypeError(`Unsafe CSS output path: ${outputPath}`);
      }

      for (
        const [owners, key, label] of [
          [logicalOwners, normalizedCollisionKey(logicalPath), "input"],
          [outputOwners, normalizedCollisionKey(outputRelativePath), "output"],
        ] as const
      ) {
        const previous = owners.get(key);
        if (previous !== undefined) {
          throw new TypeError(
            `CSS ${label} collision between ${previous} and ${sourcePath}`,
          );
        }
        owners.set(key, sourcePath);
      }
      plans.push({
        sourcePath,
        logicalPath,
        outputRelativePath,
        outputProjectPath,
      });
    }
    return plans;
  }

  private async optimizeFile(
    plan: PlannedCSSFile,
    stagingDir: string,
    optimizationSession: CSSOptimizationSession,
    purgingSession?: CSSPurgingSession,
  ): Promise<CSSBundle> {
    const content = await this.secureFs.readFile(plan.sourcePath);
    const originalSize = encoder.encode(content).length;
    if (originalSize > MAX_CSS_FILE_BYTES) {
      throw new TypeError(
        `CSS input exceeds ${MAX_CSS_FILE_BYTES} bytes: ${plan.logicalPath}`,
      );
    }
    const { optimized, sourceMap } = await this.processContent(
      content,
      plan.logicalPath,
      optimizationSession,
      purgingSession,
    );

    let outputContent = optimized;
    if (this.options.sourceMap) {
      if (!sourceMap) {
        throw new TypeError(
          `CSS source map is missing for ${plan.logicalPath}`,
        );
      }
      validateCSSSourceMap(sourceMap, plan.logicalPath);
      const mapName = `${basename(plan.outputRelativePath)}.map`;
      outputContent = `${optimized}\n/*# sourceMappingURL=${encodeURIComponent(mapName)} */\n`;
    }
    const minifiedSize = encoder.encode(outputContent).length;
    if (minifiedSize > MAX_CSS_OUTPUT_FILE_BYTES) {
      throw new TypeError(
        `CSS output exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} bytes: ${plan.logicalPath}`,
      );
    }
    if (
      sourceMap !== undefined &&
      encoder.encode(sourceMap).length > MAX_CSS_OUTPUT_FILE_BYTES
    ) {
      throw new TypeError(
        `CSS source map exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} bytes: ${plan.logicalPath}`,
      );
    }

    const outputPath = join(stagingDir, plan.outputRelativePath);
    await this.secureFs.mkdir(dirname(outputPath), { recursive: true });
    await this.secureFs.writeFile(outputPath, outputContent);
    if (this.options.sourceMap && sourceMap) {
      await this.secureFs.writeFile(`${outputPath}.map`, sourceMap);
    }

    return {
      file: plan.logicalPath,
      outputFile: plan.outputProjectPath,
      content: outputContent,
      sourceMap,
      size: originalSize,
      minifiedSize,
      savings: calculateSavings(originalSize, minifiedSize),
    };
  }

  private async processContent(
    content: string,
    logicalPath: string,
    optimizationSession: CSSOptimizationSession,
    purgingSession?: CSSPurgingSession,
  ): Promise<{ optimized: string; sourceMap?: string }> {
    const purged = this.options.purge
      ? (await this.purgeStrategy.process(
        content,
        logicalPath,
        this.options,
        purgingSession,
      )).code
      : content;
    const result = optimizationSession.run({
      css: purged,
      sourcePath: logicalPath,
      minify: this.options.minify,
      sourceMap: this.options.sourceMap,
    });
    return { optimized: result.css, sourceMap: result.sourceMap };
  }

  private async collectPurgeContent(
    patterns: string[],
  ): Promise<PurgeContentSource[]> {
    const paths = new Set<string>();
    for (const pattern of patterns) {
      for (
        const path of await globFiles(pattern, {
          baseDir: this.baseDir,
          fs: this.secureFs,
          maxFiles: MAX_CSS_FILES,
        })
      ) {
        paths.add(path);
        if (paths.size > MAX_CSS_FILES) {
          throw new TypeError(
            `CSS purge content exceeds ${MAX_CSS_FILES} files`,
          );
        }
      }
    }

    let totalBytes = 0;
    const sources: PurgeContentSource[] = [];
    for (const path of [...paths].sort(compareStrings)) {
      const info = await this.adapter.fs.lstat!(path);
      if (
        !info.isFile ||
        info.isSymlink ||
        !Number.isSafeInteger(info.size) ||
        info.size < 0
      ) {
        throw new TypeError(
          `CSS purge content must be a regular file: ${path}`,
        );
      }
      if (info.size > MAX_CSS_FILE_BYTES) {
        throw new TypeError(
          `CSS purge content exceeds ${MAX_CSS_FILE_BYTES} bytes: ${path}`,
        );
      }
      const raw = await this.secureFs.readFile(path);
      const actualBytes = encoder.encode(raw).length;
      if (actualBytes > MAX_CSS_FILE_BYTES) {
        throw new TypeError(
          `CSS purge content exceeds ${MAX_CSS_FILE_BYTES} bytes: ${path}`,
        );
      }
      totalBytes += actualBytes;
      if (totalBytes > MAX_CSS_TOTAL_BYTES) {
        throw new TypeError(
          `CSS purge content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`,
        );
      }
      sources.push({
        path,
        raw,
        extension: extname(path).slice(1).toLowerCase() || "html",
      });
    }
    return sources;
  }

  getStats(): CSSOptimizerStats {
    return this.cacheManager.getStats();
  }

  getOptions(): ResolvedCSSOptimizationOptions {
    return {
      ...this.options,
      inputFiles: [...this.options.inputFiles],
      purgeContent: [...this.options.purgeContent],
      purgeSafelist: [...this.options.purgeSafelist],
    };
  }

  getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  getPurgeStrategy(): PurgeStrategy {
    return this.purgeStrategy;
  }
}
