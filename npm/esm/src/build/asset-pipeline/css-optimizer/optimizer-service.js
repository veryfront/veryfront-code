import { dirname, relative } from "../../../platform/compat/path/index.js";
import { logger } from "../../../utils/index.js";
import { createSecureFs } from "../../../security/secure-fs.js";
import { LightningCSSStrategy, MinificationStrategy, PurgeStrategy } from "./strategies/index.js";
import { CacheManager } from "./css-bundle-cache.js";
import { basicMinify, calculateSavings, findCSSFiles, getOutputPath } from "./utils.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
const DEFAULT_OPTIONS = {
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
    options;
    strategies = [];
    cacheManager;
    lightningStrategy;
    minificationStrategy;
    purgeStrategy;
    adapter;
    secureFs;
    baseDir;
    constructor(adapter, baseDir, options = {}) {
        this.adapter = adapter;
        this.baseDir = baseDir;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.cacheManager = new CacheManager();
        this.secureFs = createSecureFs({
            baseDir,
            adapter,
            context: "build",
            throwOnError: true,
        });
        this.lightningStrategy = new LightningCSSStrategy();
        this.minificationStrategy = new MinificationStrategy();
        this.purgeStrategy = new PurgeStrategy();
        this.strategies = [this.lightningStrategy, this.purgeStrategy, this.minificationStrategy];
    }
    async init() {
        if (!this.options.enabled) {
            logger.info("CSS optimization is disabled");
            return false;
        }
        const lightningReady = await this.lightningStrategy.init();
        if (lightningReady) {
            logger.info("Using Lightning CSS for optimization");
        }
        else {
            logger.info("Using fallback CSS minification");
        }
        return true;
    }
    optimize() {
        return withSpan("build.cssOptimizer.optimize", async () => {
            await this.init();
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
            await this.secureFs.mkdir(this.options.outputDir, { recursive: true });
            const cssFiles = this.options.inputFiles.length > 0
                ? this.options.inputFiles
                : await findCSSFiles(this.options.inputDir);
            logger.info(`Found ${cssFiles.length} CSS files to optimize`);
            for (const cssFile of cssFiles) {
                await this.optimizeFile(cssFile);
            }
            await this.cacheManager.writeManifest(this.options.outputDir);
            logger.info("CSS optimization complete", {
                totalBundles: this.cacheManager.size(),
                totalSavings: this.cacheManager.getTotalSavings(),
            });
            return this.cacheManager.getAllBundles();
        }, { "build.css.inputDir": this.options.inputDir, "build.css.minify": this.options.minify });
    }
    async optimizeFile(cssPath) {
        const relPath = relative(this.options.inputDir, cssPath);
        logger.debug(`Optimizing: ${relPath}`);
        try {
            const content = await this.secureFs.readFile(cssPath);
            const originalSize = new TextEncoder().encode(content).length;
            let optimized = content;
            let sourceMap;
            const strategy = this.selectStrategy();
            if (!strategy) {
                if (this.options.minify) {
                    optimized = basicMinify(content);
                }
            }
            else {
                try {
                    const result = await strategy.process(content, cssPath, this.options);
                    optimized = result.code;
                    sourceMap = result.sourceMap;
                }
                catch (error) {
                    logger.warn(`Strategy ${strategy.name} failed, using fallback`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    optimized = basicMinify(content);
                }
            }
            const outputPath = getOutputPath(relPath, this.options.outputDir);
            await this.secureFs.mkdir(dirname(outputPath), { recursive: true });
            await this.secureFs.writeFile(outputPath, optimized);
            if (sourceMap && this.options.sourceMap) {
                await this.secureFs.writeFile(`${outputPath}.map`, sourceMap);
            }
            const minifiedSize = new TextEncoder().encode(optimized).length;
            const savings = calculateSavings(originalSize, minifiedSize);
            this.cacheManager.addBundle(relPath, {
                file: relPath,
                content: optimized,
                sourceMap,
                size: originalSize,
                minifiedSize,
                savings,
            });
            logger.debug(`Optimized ${relPath}: ${originalSize} → ${minifiedSize} bytes (${savings.toFixed(1)}% reduction)`);
        }
        catch (error) {
            logger.error(`Failed to optimize ${relPath}`, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    selectStrategy() {
        const sortedStrategies = [...this.strategies].sort((a, b) => b.priority - a.priority);
        for (const strategy of sortedStrategies) {
            if (strategy.canProcess(this.options)) {
                logger.debug(`Selected strategy: ${strategy.name}`);
                return strategy;
            }
        }
        return null;
    }
    getStats() {
        return this.cacheManager.getStats();
    }
    getOptions() {
        return this.options;
    }
    getCacheManager() {
        return this.cacheManager;
    }
    getPurgeStrategy() {
        return this.purgeStrategy;
    }
}
