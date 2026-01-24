import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { BYTES_PER_KB, logger } from "#veryfront/utils";
import type { CSSBundle } from "#veryfront/types";

const fs = createFileSystem();

type CacheStats = {
  totalFiles: number;
  originalSize: number;
  minifiedSize: number;
  totalSavings: number;
  averageSavings: number;
};

export class CacheManager {
  private bundles = new Map<string, CSSBundle>();
  private cachedStats: CacheStats | null = null;

  addBundle(key: string, bundle: CSSBundle): void {
    this.bundles.set(key, bundle);
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
          if (typeof value !== "object" || value === null || !("content" in value)) return value;
          const { content: _content, sourceMap: _sourceMap, ...rest } = value as CSSBundle;
          return rest;
        },
        2,
      ),
    );

    logger.debug(`Wrote CSS manifest to ${manifestPath}`);
  }

  getTotalSavings(): string {
    const { originalSize, minifiedSize } = this.getStats();
    const savings = originalSize > 0 ? ((originalSize - minifiedSize) / originalSize) * 100 : 0;

    return `${(originalSize / BYTES_PER_KB).toFixed(1)}KB → ${
      (minifiedSize / BYTES_PER_KB).toFixed(
        1,
      )
    }KB (${savings.toFixed(1)}%)`;
  }

  getStats(): CacheStats {
    if (this.cachedStats) return this.cachedStats;

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

export async function loadCSSManifest(
  outputDir: string = "./.veryfront/optimized-css",
): Promise<Map<string, CSSBundle>> {
  const manifestPath = join(outputDir, "css-manifest.json");

  try {
    const content = await fs.readTextFile(manifestPath);
    const data = JSON.parse(content) as Record<string, CSSBundle>;
    return new Map(Object.entries(data));
  } catch (error) {
    logger.warn("Failed to load CSS manifest", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}
