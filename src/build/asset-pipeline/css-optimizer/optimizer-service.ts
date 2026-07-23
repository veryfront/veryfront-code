import { dirname, extname, isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import type {
  BrowserTargets,
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizerStats,
} from "./types/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs, type SecureFs } from "#veryfront/security/secure-fs.ts";
import { LightningCSSStrategy, PurgeStrategy } from "./strategies/index.ts";
import { CacheManager } from "./css-bundle-cache.ts";
import { basicMinify, calculateSavings, findCSSFiles, getOutputPath } from "./utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { extractCriticalCSS } from "./critical-css.ts";

const DEFAULT_OPTIONS: Required<CSSOptimizationOptions> = {
  enabled: true,
  minify: true,
  autoprefixer: false,
  purge: false,
  criticalCSS: false,
  inputFiles: [],
  inputDir: "./styles",
  outputDir: "./.veryfront/optimized-css",
  browsers: {},
  purgeContent: ["./app/**/*.{tsx,jsx,ts,js}", "./pages/**/*.{tsx,jsx,ts,js}"],
  sourceMap: false,
};

function isWithin(baseDir: string, target: string): boolean {
  const relPath = relative(baseDir, target);
  return relPath === "" ||
    (!isAbsolute(relPath) && relPath.replaceAll("\\", "/").split("/")[0] !== "..");
}

const SEPARATOR = /\\|\//;

function resolveWithin(baseDir: string, path: string, label: string): string {
  if (!path.trim()) throw new TypeError(`${label} must not be blank`);
  const resolvedPath = resolve(baseDir, path);
  if (!isWithin(baseDir, resolvedPath)) throw new TypeError(`${label} must stay inside baseDir`);
  return resolvedPath;
}

function normalizeOptions(
  baseDir: string,
  options: CSSOptimizationOptions,
): Required<CSSOptimizationOptions> {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  for (
    const key of [
      "enabled",
      "minify",
      "autoprefixer",
      "purge",
      "criticalCSS",
      "sourceMap",
    ] as const
  ) {
    if (typeof merged[key] !== "boolean") throw new TypeError(`${key} must be a boolean`);
  }
  if (merged.criticalCSS) {
    throw new TypeError("criticalCSS requires HTML input. Use extractCriticalCSS explicitly");
  }
  if (!Array.isArray(merged.inputFiles) || !Array.isArray(merged.purgeContent)) {
    throw new TypeError("inputFiles and purgeContent must be arrays");
  }
  if (merged.purge && merged.purgeContent.length === 0) {
    throw new TypeError("purgeContent must not be empty when purge is enabled");
  }

  const inputDir = resolveWithin(baseDir, merged.inputDir, "inputDir");
  const outputDir = resolveWithin(baseDir, merged.outputDir, "outputDir");
  const outputRelativeToInput = relative(inputDir, outputDir);
  const inputRelativeToOutput = relative(outputDir, inputDir);
  if (
    outputRelativeToInput === "" ||
    (!isAbsolute(outputRelativeToInput) &&
      !outputRelativeToInput.split(SEPARATOR).includes("..")) ||
    (!isAbsolute(inputRelativeToOutput) && !inputRelativeToOutput.split(SEPARATOR).includes(".."))
  ) {
    throw new TypeError("inputDir and outputDir must not contain one another");
  }

  const inputFiles = merged.inputFiles.map((path) => {
    const resolvedPath = resolveWithin(baseDir, path, "inputFiles entry");
    if (extname(resolvedPath).toLowerCase() !== ".css") {
      throw new TypeError("inputFiles entries must use the .css extension");
    }
    return resolvedPath;
  });
  const purgeContent = merged.purgeContent.map((pattern) => {
    const staticPrefix = pattern.split(/[?*[{]/, 1)[0] || ".";
    resolveWithin(baseDir, staticPrefix, "purgeContent entry");
    return isAbsolute(pattern) ? pattern : resolve(baseDir, pattern);
  });
  const browsers = Array.isArray(merged.browsers)
    ? [...merged.browsers]
    : { ...(merged.browsers as BrowserTargets) };

  return {
    ...merged,
    inputDir,
    outputDir,
    inputFiles: [...new Set(inputFiles)].sort(),
    purgeContent: [...new Set(purgeContent)].sort(),
    browsers,
  };
}

export class CSSOptimizerService {
  private options: Required<CSSOptimizationOptions>;
  private cacheManager: CacheManager;
  private lightningStrategy: LightningCSSStrategy;
  private purgeStrategy: PurgeStrategy;
  private secureFs: SecureFs;
  private baseDir: string;
  private optimizationPromise: Promise<Map<string, CSSBundle>> | null = null;

  constructor(adapter: RuntimeAdapter, baseDir: string, options: CSSOptimizationOptions = {}) {
    if (!baseDir.trim()) throw new TypeError("baseDir must not be blank");
    this.baseDir = resolve(baseDir);
    this.options = normalizeOptions(this.baseDir, options);
    this.cacheManager = new CacheManager();

    this.secureFs = createSecureFs({
      baseDir: this.baseDir,
      adapter,
      context: "build",
      throwOnError: true,
      validationOptions: { followSymlinks: false },
    });

    this.lightningStrategy = new LightningCSSStrategy();
    this.purgeStrategy = new PurgeStrategy();
  }

  async init(): Promise<boolean> {
    if (!this.options.enabled) {
      logger.info("CSS optimization is disabled");
      return false;
    }

    const lightningReady = await this.lightningStrategy.init();
    logger.info(lightningReady ? "Using Lightning CSS for optimization" : "Using CSS minification");
    if (!lightningReady && (this.options.autoprefixer || this.options.sourceMap)) {
      throw INITIALIZATION_ERROR.create({
        detail: "Lightning CSS is required for autoprefixing and source maps",
      });
    }

    return lightningReady;
  }

  optimize(): Promise<Map<string, CSSBundle>> {
    if (this.optimizationPromise) {
      return this.optimizationPromise.then((bundles) => new Map(bundles));
    }
    const promise = withSpan(
      "build.cssOptimizer.optimize",
      async () => {
        await this.init();

        if (!this.options.enabled) {
          return new Map();
        }

        logger.info("Starting CSS optimization", {
          minify: this.options.minify,
          autoprefixer: this.options.autoprefixer,
          purge: this.options.purge,
        });

        await this.secureFs.mkdir(this.options.outputDir, { recursive: true });
        const previousBundles = this.cacheManager.getAllBundles();
        this.cacheManager.clear();
        this.purgeStrategy.clearCache();

        const cssFiles = [
          ...new Set(
            this.options.inputFiles.length
              ? this.options.inputFiles
              : await findCSSFiles(this.options.inputDir),
          ),
        ].sort();

        logger.info(`Found ${cssFiles.length} CSS files to optimize`);

        const processed = [];
        const keys = new Set<string>();
        for (const cssFile of cssFiles) {
          const result = await this.processFile(cssFile, this.options.inputFiles.length > 0);
          if (keys.has(result.relPath)) {
            throw new TypeError(`Duplicate CSS output path: ${result.relPath}`);
          }
          keys.add(result.relPath);
          processed.push(result);
        }

        for (const previousPath of previousBundles.keys()) {
          if (keys.has(previousPath)) continue;
          const staleOutputPath = getOutputPath(previousPath, this.options.outputDir);
          if (await this.secureFs.exists(staleOutputPath)) {
            await this.secureFs.remove(staleOutputPath);
          }
          const staleSourceMapPath = `${staleOutputPath}.map`;
          if (await this.secureFs.exists(staleSourceMapPath)) {
            await this.secureFs.remove(staleSourceMapPath);
          }
        }

        for (const { bundle, outputPath, relPath } of processed) {
          await this.secureFs.mkdir(dirname(outputPath), { recursive: true });
          await this.secureFs.writeFile(outputPath, bundle.content);
          if (this.options.sourceMap && bundle.sourceMap) {
            await this.secureFs.writeFile(`${outputPath}.map`, bundle.sourceMap);
          }
          this.cacheManager.addBundle(relPath, bundle);
        }

        await this.cacheManager.writeManifest(this.options.outputDir);

        logger.info("CSS optimization complete", {
          totalBundles: this.cacheManager.size(),
          totalSavings: this.cacheManager.getTotalSavings(),
        });

        return this.cacheManager.getAllBundles();
      },
      { "build.css.minify": this.options.minify },
    );
    this.optimizationPromise = promise;
    return promise.finally(() => {
      this.optimizationPromise = null;
    });
  }

  private async processFile(
    cssPath: string,
    explicitInput: boolean,
  ): Promise<{ relPath: string; outputPath: string; bundle: CSSBundle }> {
    const relPath = relative(explicitInput ? this.baseDir : this.options.inputDir, cssPath)
      .replaceAll(
        "\\",
        "/",
      );
    if (!relPath || isAbsolute(relPath) || relPath.split("/").includes("..")) {
      throw new TypeError("CSS input path must stay inside its configured input root");
    }
    logger.debug(`Optimizing: ${relPath}`);

    const content = await this.secureFs.readFile(cssPath);
    const originalSize = new TextEncoder().encode(content).length;

    const { optimized, sourceMap } = await this.processContent(content, cssPath);

    const outputPath = getOutputPath(relPath, this.options.outputDir);

    const minifiedSize = new TextEncoder().encode(optimized).length;
    const savings = calculateSavings(originalSize, minifiedSize);

    logger.debug("Optimized CSS", { file: relPath, originalSize, minifiedSize, savings });
    return {
      relPath,
      outputPath,
      bundle: {
        file: relPath,
        content: optimized,
        sourceMap,
        size: originalSize,
        minifiedSize,
        savings,
      },
    };
  }

  private async processContent(
    content: string,
    cssPath: string,
  ): Promise<{ optimized: string; sourceMap?: string }> {
    // Lightning CSS supports parser recovery, which is useful for editors but
    // unsafe for production builds because it can silently rewrite malformed
    // input. Validate structural syntax before invoking any strategy.
    basicMinify(content);
    let processed = content;
    if (this.options.purge) {
      processed = (await this.purgeStrategy.process(processed, cssPath, this.options)).code;
    }

    if (
      this.lightningStrategy.isAvailable() &&
      (this.options.minify || this.options.autoprefixer || this.options.sourceMap)
    ) {
      const result = await this.lightningStrategy.process(processed, cssPath, this.options);
      return { optimized: result.code, sourceMap: result.sourceMap };
    }
    if (this.options.autoprefixer || this.options.sourceMap) {
      throw INITIALIZATION_ERROR.create({
        detail: "Lightning CSS is required for autoprefixing and source maps",
      });
    }

    const validated = basicMinify(processed);
    return { optimized: this.options.minify ? validated : processed };
  }

  getStats(): CSSOptimizerStats {
    return this.cacheManager.getStats();
  }

  extractCriticalCSS(cssPath: string, htmlContent: string): Promise<CriticalCSSResult> {
    const resolvedPath = resolveWithin(this.baseDir, cssPath, "cssPath");
    if (extname(resolvedPath).toLowerCase() !== ".css") {
      throw new TypeError("cssPath must use the .css extension");
    }
    return extractCriticalCSS(resolvedPath, htmlContent, this.options);
  }

  getOptions(): Required<CSSOptimizationOptions> {
    return {
      ...this.options,
      inputFiles: [...this.options.inputFiles],
      purgeContent: [...this.options.purgeContent],
      browsers: Array.isArray(this.options.browsers)
        ? [...this.options.browsers]
        : { ...this.options.browsers },
    };
  }

  getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  getPurgeStrategy(): PurgeStrategy {
    return this.purgeStrategy;
  }
}
