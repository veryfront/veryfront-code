import { join } from "../../../platform/compat/path/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { BYTES_PER_KB, logger } from "../../../utils/index.js";
const fs = createFileSystem();
export class CacheManager {
    bundles = new Map();
    cachedStats = null;
    addBundle(key, bundle) {
        this.bundles.set(key, bundle);
        this.cachedStats = null;
    }
    getBundle(key) {
        return this.bundles.get(key);
    }
    getAllBundles() {
        return this.bundles;
    }
    clear() {
        this.bundles.clear();
        this.cachedStats = null;
    }
    size() {
        return this.bundles.size;
    }
    async writeManifest(outputDir) {
        await fs.mkdir(outputDir, { recursive: true });
        const manifestPath = join(outputDir, "css-manifest.json");
        const manifest = Object.fromEntries(this.bundles);
        await fs.writeTextFile(manifestPath, JSON.stringify(manifest, (_key, value) => {
            if (typeof value !== "object" || value === null || !("content" in value))
                return value;
            const { content: _content, sourceMap: _sourceMap, ...rest } = value;
            return rest;
        }, 2));
        logger.debug(`Wrote CSS manifest to ${manifestPath}`);
    }
    getTotalSavings() {
        const { originalSize, minifiedSize } = this.getStats();
        const savings = originalSize > 0 ? ((originalSize - minifiedSize) / originalSize) * 100 : 0;
        return `${(originalSize / BYTES_PER_KB).toFixed(1)}KB → ${(minifiedSize / BYTES_PER_KB).toFixed(1)}KB (${savings.toFixed(1)}%)`;
    }
    getStats() {
        if (this.cachedStats)
            return this.cachedStats;
        let originalSize = 0;
        let minifiedSize = 0;
        for (const { size, minifiedSize: bundleMinifiedSize } of this.bundles.values()) {
            originalSize += size;
            minifiedSize += bundleMinifiedSize;
        }
        const totalSavings = originalSize - minifiedSize;
        const averageSavings = originalSize > 0 ? (totalSavings / originalSize) * 100 : 0;
        this.cachedStats = {
            totalFiles: this.bundles.size,
            originalSize,
            minifiedSize,
            totalSavings,
            averageSavings,
        };
        return this.cachedStats;
    }
}
export async function loadCSSManifest(outputDir = "./.veryfront/optimized-css") {
    const manifestPath = join(outputDir, "css-manifest.json");
    try {
        const content = await fs.readTextFile(manifestPath);
        const data = JSON.parse(content);
        return new Map(Object.entries(data));
    }
    catch (error) {
        logger.warn("Failed to load CSS manifest", {
            error: error instanceof Error ? error.message : String(error),
        });
        return new Map();
    }
}
