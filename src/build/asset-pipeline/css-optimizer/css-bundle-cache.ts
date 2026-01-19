import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { logger } from "#veryfront/utils";
import { BYTES_PER_KB } from "#veryfront/utils";
import type { CSSBundle } from "#veryfront/types";

const fs = createFileSystem();

export class CacheManager {
  private bundles: Map<string, CSSBundle> = new Map();
  private cachedStats: {
    totalFiles: number;
    originalSize: number;
    minifiedSize: number;
    totalSavings: number;
    averageSavings: number;
  } | null = null;

  addBundle(key: string, bundle: CSSBundle): void {
    this.bundles.set(key, bundle);
    // Invalidate cache when bundles change
    this.cachedStats = null;
  }

  getBundle(key: string): CSSBundle | undefined {
    return this.bundles.get(key);
  }

  getAllBundles(): Map<string, CSSBundle> {
    return this.bundles;
  }

  clear(): void {
    this.bundles.clear();
    this.cachedStats = null;
  }

  size(): number {
    return this.bundles.size;
  }

  async writeManifest(outputDir: string): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });

    const manifestPath = join(outputDir, "css-manifest.json");
    const manifest = Object.fromEntries(this.bundles);

    await fs.writeTextFile(
      manifestPath,
      JSON.stringify(
        manifest,
        (_key, value) => {
          // Don't include full content in manifest to reduce file size
          if (typeof value === "object" && value !== null && "content" in value) {
            const { content: _content, sourceMap: _sourceMap, ...rest } = value;
            return rest;
          }
          return value;
        },
        2,
      ),
    );

    logger.debug(`Wrote CSS manifest to ${manifestPath}`);
  }

  getTotalSavings(): string {
    const stats = this.getStats();
    const savings = stats.originalSize > 0
      ? ((stats.originalSize - stats.minifiedSize) / stats.originalSize) * 100
      : 0;

    return `${(stats.originalSize / BYTES_PER_KB).toFixed(1)}KB → ${
      (stats.minifiedSize / BYTES_PER_KB).toFixed(1)
    }KB (${savings.toFixed(1)}%)`;
  }

  getStats(): {
    totalFiles: number;
    originalSize: number;
    minifiedSize: number;
    totalSavings: number;
    averageSavings: number;
  } {
    // Return cached stats if available
    if (this.cachedStats !== null) {
      return this.cachedStats;
    }

    // Calculate stats once
    let originalSize = 0;
    let minifiedSize = 0;

    for (const bundle of this.bundles.values()) {
      originalSize += bundle.size;
      minifiedSize += bundle.minifiedSize;
    }

    const totalSavings = originalSize - minifiedSize;
    const averageSavings = originalSize > 0 ? (totalSavings / originalSize) * 100 : 0;

    // Cache the result
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

export async function loadCSSManifest(
  outputDir: string = "./.veryfront/optimized-css",
): Promise<Map<string, CSSBundle>> {
  const manifestPath = join(outputDir, "css-manifest.json");

  try {
    const content = await fs.readTextFile(manifestPath);
    const data = JSON.parse(content);
    return new Map(Object.entries(data));
  } catch (error) {
    logger.warn("Failed to load CSS manifest", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}
