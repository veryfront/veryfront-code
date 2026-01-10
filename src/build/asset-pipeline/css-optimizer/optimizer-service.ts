import { dirname, relative } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import type {
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
} from "@veryfront/types";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createSecureFs, type SecureFs } from "@veryfront/security/secure-fs.ts";
import { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.ts";
import { CacheManager } from "./css-bundle-cache.ts";
import { basicMinify, calculateSavings, findCSSFiles, getOutputPath } from "./utils.ts";

const DEFAULT_OPTIONS: Required<CSSOptimizationOptions> = {
  enabled: true,
  minify: true,
  autoprefixer: true,
  purge: false,
  criticalCSS: false,
  inputFiles: [],
  inputDir: "./styles",
  outputDir: "./.veryfront/optimized-css",
  browsers: ["defaults", "not IE 11"],
  purgeContent: ["./app/**/*.{tsx,jsx,ts,js}", "./pages/**/*.{tsx,jsx,ts,js}"],
  sourceMap: false,
};

export class CSSOptimizerService {
  private options: Required<CSSOptimizationOptions>;
  private strategies: CSSOptimizationStrategy[] = [];
  private cacheManager: CacheManager;
  private lightningStrategy: LightningCSSStrategy;
  private minificationStrategy: MinificationStrategy;
  private purgeStrategy: PurgeStrategy;
  private adapter: RuntimeAdapter;
  private secureFs: SecureFs;
  private baseDir: string;

  constructor(
    adapter: RuntimeAdapter,
    baseDir: string,
    options: CSSOptimizationOptions = {},
  ) {
    this.adapter = adapter;
    this.baseDir = baseDir;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cacheManager = new CacheManager();

    // Initialize secure filesystem with build context
    this.secureFs = createSecureFs({
      baseDir,
      adapter,
      context: "build",
      throwOnError: true,
    });

    // Initialize strategies
    this.lightningStrategy = new LightningCSSStrategy();
    this.minificationStrategy = new MinificationStrategy();
    this.purgeStrategy = new PurgeStrategy();

    this.strategies = [
      this.lightningStrategy,
      this.purgeStrategy,
      this.minificationStrategy,
    ];
  }

  async init(): Promise<boolean> {
    if (!this.options.enabled) {
      logger.info("CSS optimization is disabled");
      return false;
    }

    // Try to initialize Lightning CSS
    const lightningReady = await this.lightningStrategy.init();

    if (lightningReady) {
      logger.info("Using Lightning CSS for optimization");
    } else {
      logger.info("Using fallback CSS minification");
    }

    return true;
  }

  async optimize(): Promise<Map<string, CSSBundle>> {
    const _isReady = await this.init();

    if (!this.options.enabled) {
      return new Map();
    }

    logger.info("Starting CSS optimization", {
      inputDir: this.options.inputDir,
      outputDir: this.options.outputDir,
      minify: this.options.minify,
      autoprefixer: this.options.autoprefixer,
      purge: this.options.purge,
    });

    // Create output directory using secure filesystem
    await this.secureFs.mkdir(this.options.outputDir, { recursive: true });

    // Find all CSS files
    const cssFiles = this.options.inputFiles.length > 0
      ? this.options.inputFiles
      : await findCSSFiles(this.options.inputDir);

    logger.info(`Found ${cssFiles.length} CSS files to optimize`);

    // Process CSS files
    for (const cssFile of cssFiles) {
      await this.optimizeFile(cssFile);
    }

    // Write manifest
    await this.cacheManager.writeManifest(this.options.outputDir);

    logger.info("CSS optimization complete", {
      totalBundles: this.cacheManager.size(),
      totalSavings: this.cacheManager.getTotalSavings(),
    });

    return this.cacheManager.getAllBundles();
  }

  private async optimizeFile(cssPath: string): Promise<void> {
    const relPath = relative(this.options.inputDir, cssPath);
    logger.debug(`Optimizing: ${relPath}`);

    try {
      // Read file using secure filesystem (with path validation)
      const content = await this.secureFs.readFile(cssPath);
      const originalSize = new TextEncoder().encode(content).length;

      let optimized = content;
      let sourceMap: string | undefined;

      // Select and apply the best strategy
      const strategy = this.selectStrategy();

      if (strategy) {
        try {
          const result = await strategy.process(content, cssPath, this.options);
          optimized = result.code;
          sourceMap = result.sourceMap;
        } catch (error) {
          logger.warn(`Strategy ${strategy.name} failed, using fallback`, {
            error: error instanceof Error ? error.message : String(error),
          });
          // Fallback to basic minification
          optimized = basicMinify(content);
        }
      } else {
        // No strategy available, keep original or use basic minification
        if (this.options.minify) {
          optimized = basicMinify(content);
        }
      }

      // Write optimized file using secure filesystem
      const outputPath = getOutputPath(relPath, this.options.outputDir);
      await this.secureFs.mkdir(dirname(outputPath), { recursive: true });
      await this.secureFs.writeFile(outputPath, optimized);

      // Write source map if enabled
      if (sourceMap && this.options.sourceMap) {
        await this.secureFs.writeFile(`${outputPath}.map`, sourceMap);
      }

      const minifiedSize = new TextEncoder().encode(optimized).length;
      const savings = calculateSavings(originalSize, minifiedSize);

      // Store bundle info
      this.cacheManager.addBundle(relPath, {
        file: relPath,
        content: optimized,
        sourceMap,
        size: originalSize,
        minifiedSize,
        savings,
      });

      logger.debug(
        `Optimized ${relPath}: ${originalSize} → ${minifiedSize} bytes (${
          savings.toFixed(1)
        }% reduction)`,
      );
    } catch (error) {
      logger.error(`Failed to optimize ${relPath}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private selectStrategy(): CSSOptimizationStrategy | null {
    // Sort strategies by priority (descending)
    const sortedStrategies = [...this.strategies].sort((a, b) => b.priority - a.priority);

    // Find the first strategy that can process
    for (const strategy of sortedStrategies) {
      if (strategy.canProcess(this.options)) {
        logger.debug(`Selected strategy: ${strategy.name}`);
        return strategy;
      }
    }

    return null;
  }

  getStats(): CSSOptimizerStats {
    return this.cacheManager.getStats();
  }

  getOptions(): Required<CSSOptimizationOptions> {
    return this.options;
  }

  getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  getPurgeStrategy(): PurgeStrategy {
    return this.purgeStrategy;
  }
}
