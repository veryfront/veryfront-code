import { extname, isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { BYTES_PER_KB, logger } from "#veryfront/utils";
import type { CSSBundle } from "./types/index.ts";

const fs = createFileSystem();
const encoder = new TextEncoder();

type CSSManifestEntry = Omit<CSSBundle, "content" | "sourceMap">;

function cloneBundle(bundle: CSSBundle): CSSBundle {
  return { ...bundle };
}

function isSafeCSSPath(path: unknown): path is string {
  if (typeof path !== "string" || !path || isAbsolute(path)) return false;
  const normalized = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized) || extname(normalized).toLowerCase() !== ".css") return false;
  if (normalized.includes("\0") || normalized.includes("?") || normalized.includes("#")) {
    return false;
  }
  return !normalized.split("/").some((segment) => !segment || segment === "." || segment === "..");
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isValidSavings(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -100 && value <= 100;
}

function parseManifest(content: string): Map<string, CSSManifestEntry> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new SyntaxError("Invalid CSS manifest JSON", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Invalid CSS manifest structure");
  }

  const entries: Array<[string, CSSManifestEntry]> = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError(`Invalid CSS manifest entry: ${key}`);
    }
    const entry = value as Record<string, unknown>;
    if (
      !isSafeCSSPath(key) || entry.file !== key || !isSafeCSSPath(entry.file) ||
      !isNonNegativeInteger(entry.size) || !isNonNegativeInteger(entry.minifiedSize) ||
      !isValidSavings(entry.savings)
    ) {
      throw new TypeError(`Invalid CSS manifest entry: ${key}`);
    }
    entries.push([key, {
      file: entry.file,
      size: entry.size,
      minifiedSize: entry.minifiedSize,
      savings: entry.savings,
    }]);
  }
  return new Map(entries);
}

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
    if (
      !bundle || typeof bundle !== "object" || !isSafeCSSPath(key) || bundle.file !== key ||
      typeof bundle.content !== "string" ||
      (bundle.sourceMap !== undefined && typeof bundle.sourceMap !== "string") ||
      !isNonNegativeInteger(bundle.size) || !isNonNegativeInteger(bundle.minifiedSize) ||
      !isValidSavings(bundle.savings)
    ) {
      throw new TypeError("CSS cache keys and bundle paths must be matching relative CSS paths");
    }
    this.bundles.set(key, cloneBundle(bundle));
    this.cachedStats = null;
  }

  getBundle(key: string): CSSBundle | undefined {
    const bundle = this.bundles.get(key);
    return bundle ? cloneBundle(bundle) : undefined;
  }

  getAllBundles(): Map<string, CSSBundle> {
    return new Map([...this.bundles].map(([key, bundle]) => [key, cloneBundle(bundle)]));
  }

  clear(): void {
    this.bundles.clear();
    this.cachedStats = null;
  }

  size(): number {
    return this.bundles.size;
  }

  async writeManifest(outputDir: string): Promise<void> {
    if (typeof outputDir !== "string" || outputDir.trim() === "") {
      throw new TypeError("CSS manifest outputDir must not be blank");
    }

    const manifestPath = join(outputDir, "css-manifest.json");
    const manifest = Object.fromEntries(this.bundles);

    const serialized = JSON.stringify(
      manifest,
      (_key, value) => {
        if (typeof value !== "object" || value === null || !("content" in value)) return value;
        const { content: _content, sourceMap: _sourceMap, ...rest } = value;
        return rest;
      },
      2,
    );
    parseManifest(serialized);

    const temporaryPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
    const rename = fs.rename?.bind(fs);
    if (!rename) throw new TypeError("Atomic CSS manifest writes are not supported");
    await fs.mkdir(outputDir, { recursive: true });
    try {
      await fs.writeTextFile(temporaryPath, serialized);
      await rename(temporaryPath, manifestPath);
    } catch (error) {
      try {
        await fs.remove(temporaryPath);
      } catch (cleanupError) {
        if (!isNotFoundError(cleanupError)) {
          throw new AggregateError(
            [error, cleanupError],
            "CSS manifest write and temporary-file cleanup both failed",
          );
        }
      }
      throw error;
    }

    logger.debug("Wrote CSS manifest", { bundleCount: this.bundles.size });
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
    if (this.cachedStats) return { ...this.cachedStats };

    let originalSize = 0;
    let minifiedSize = 0;

    for (const bundle of this.bundles.values()) {
      originalSize += bundle.size;
      minifiedSize += bundle.minifiedSize;
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

    return { ...this.cachedStats };
  }
}

export async function loadCSSManifest(
  outputDir: string = "./.veryfront/optimized-css",
): Promise<Map<string, CSSBundle>> {
  const manifestPath = join(outputDir, "css-manifest.json");

  try {
    const content = await fs.readTextFile(manifestPath);
    const manifest = parseManifest(content);
    const bundles = new Map<string, CSSBundle>();

    for (const [key, entry] of manifest) {
      const optimizedPath = join(outputDir, key.replace(/\.css$/i, ".min.css"));
      const optimizedContent = await fs.readTextFile(optimizedPath);
      const actualSize = encoder.encode(optimizedContent).length;
      if (actualSize !== entry.minifiedSize) {
        throw new TypeError(`CSS manifest size mismatch: ${key}`);
      }
      const sourceMapPath = `${optimizedPath}.map`;
      const sourceMap = await fs.exists(sourceMapPath)
        ? await fs.readTextFile(sourceMapPath)
        : undefined;
      bundles.set(key, { ...entry, content: optimizedContent, sourceMap });
    }
    return bundles;
  } catch (error) {
    if (isNotFoundError(error) && !(await fs.exists(manifestPath))) return new Map();
    throw error;
  }
}
