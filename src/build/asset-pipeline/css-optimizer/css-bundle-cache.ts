import { join } from "#veryfront/compat/path/index.ts";
import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import { BYTES_PER_KB, logger } from "#veryfront/utils";
import {
  CSS_MANIFEST_FILENAME,
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_MANIFEST_BYTES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_TOTAL_OUTPUT_BYTES,
} from "./constants.ts";
import type { CSSBundle, CSSOptimizerStats } from "./types/index.ts";
import {
  calculateSavings,
  getOutputPath,
  isSafeCSSRelativePath,
  validateCSSSourceMap,
} from "./utils.ts";

const encoder = new TextEncoder();

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneBundle(bundle: CSSBundle): CSSBundle {
  return { ...bundle };
}

function cloneBundles(
  bundles: Map<string, CSSBundle>,
): Map<string, CSSBundle> {
  return new Map(
    [...bundles].map(([key, bundle]) => [key, cloneBundle(bundle)]),
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function assertBundle(
  key: string,
  value: unknown,
  requireContent: boolean,
): asserts value is CSSBundle {
  if (
    !isSafeCSSRelativePath(key) ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`CSS manifest entry ${JSON.stringify(key)} is malformed`);
  }
  const bundle = value as Partial<CSSBundle>;
  if (
    bundle.file !== key ||
    (bundle.outputFile !== undefined &&
      !isSafeCSSRelativePath(bundle.outputFile)) ||
    (requireContent && typeof bundle.content !== "string") ||
    (bundle.content !== undefined && typeof bundle.content !== "string") ||
    (bundle.sourceMap !== undefined && typeof bundle.sourceMap !== "string") ||
    !isNonNegativeSafeInteger(bundle.size) ||
    !isNonNegativeSafeInteger(bundle.minifiedSize) ||
    bundle.size > MAX_CSS_FILE_BYTES ||
    bundle.minifiedSize > MAX_CSS_OUTPUT_FILE_BYTES ||
    typeof bundle.savings !== "number" ||
    !Number.isFinite(bundle.savings) ||
    bundle.savings !== calculateSavings(bundle.size, bundle.minifiedSize)
  ) {
    throw new TypeError(`CSS manifest entry ${JSON.stringify(key)} is malformed`);
  }
  if (
    typeof bundle.content === "string" &&
    encoder.encode(bundle.content).length !== bundle.minifiedSize
  ) {
    throw new TypeError(
      `CSS manifest entry ${JSON.stringify(key)} has an invalid content size`,
    );
  }
  if (
    typeof bundle.sourceMap === "string" &&
    encoder.encode(bundle.sourceMap).length > MAX_CSS_OUTPUT_FILE_BYTES
  ) {
    throw new TypeError(
      `CSS manifest entry ${JSON.stringify(key)} has an oversized source map`,
    );
  }
  if (typeof bundle.sourceMap === "string") {
    validateCSSSourceMap(bundle.sourceMap, key);
  }
}

function assertBundles(
  entries: Array<[string, unknown]>,
  requireContent: boolean,
): asserts entries is Array<[string, CSSBundle]> {
  if (entries.length > MAX_CSS_FILES) {
    throw new TypeError(`CSS manifest exceeds ${MAX_CSS_FILES} entries`);
  }
  const normalizedKeys = new Set<string>();
  const normalizedOutputs = new Set<string>();
  let totalOutputBytes = 0;
  for (const [key, value] of entries) {
    assertBundle(key, value, requireContent);
    const normalizedKey = key.normalize("NFC").toLocaleLowerCase("en-US");
    const output = value.outputFile ??
      getOutputPath(key, ".").replaceAll("\\", "/").replace(/^\.\//, "");
    const normalizedOutput = output.normalize("NFC").toLocaleLowerCase("en-US");
    if (
      normalizedKeys.has(normalizedKey) ||
      normalizedOutputs.has(normalizedOutput)
    ) {
      throw new TypeError(
        `CSS manifest contains a path collision: ${JSON.stringify(key)}`,
      );
    }
    normalizedKeys.add(normalizedKey);
    normalizedOutputs.add(normalizedOutput);
    totalOutputBytes += value.minifiedSize +
      (value.sourceMap === undefined ? 0 : encoder.encode(value.sourceMap).length);
    if (totalOutputBytes > MAX_CSS_TOTAL_OUTPUT_BYTES) {
      throw new TypeError(
        `CSS manifest outputs exceed ${MAX_CSS_TOTAL_OUTPUT_BYTES} total bytes`,
      );
    }
  }
}

export class CacheManager {
  private bundles = new Map<string, CSSBundle>();
  private cachedStats: CSSOptimizerStats | null = null;

  addBundle(key: string, bundle: CSSBundle): void {
    assertBundle(key, bundle, true);
    const next = new Map(this.bundles);
    next.set(key, cloneBundle(bundle));
    assertBundles([...next], true);
    this.bundles = next;
    this.cachedStats = null;
  }

  getBundle(key: string): CSSBundle | undefined {
    const bundle = this.bundles.get(key);
    return bundle ? cloneBundle(bundle) : undefined;
  }

  getAllBundles(): Map<string, CSSBundle> {
    return cloneBundles(this.bundles);
  }

  clear(): void {
    this.bundles.clear();
    this.cachedStats = null;
  }

  size(): number {
    return this.bundles.size;
  }

  serializeManifest(): string {
    const entries = [...this.bundles].sort(([left], [right]) => comparePaths(left, right));
    assertBundles(entries, true);
    const content = `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
    if (encoder.encode(content).length > MAX_CSS_MANIFEST_BYTES) {
      throw new TypeError(
        `CSS manifest exceeds ${MAX_CSS_MANIFEST_BYTES} bytes`,
      );
    }
    return content;
  }

  async writeManifest(
    outputDir: string,
    fs: FileSystem = createFileSystem(),
  ): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    const manifestPath = join(outputDir, CSS_MANIFEST_FILENAME);
    await fs.writeTextFile(manifestPath, this.serializeManifest());
    logger.debug(`Wrote CSS manifest to ${manifestPath}`);
  }

  getTotalSavings(): string {
    const { originalSize, minifiedSize } = this.getStats();
    const savings = originalSize > 0 ? ((originalSize - minifiedSize) / originalSize) * 100 : 0;
    return `${(originalSize / BYTES_PER_KB).toFixed(1)}KB → ${
      (minifiedSize / BYTES_PER_KB).toFixed(1)
    }KB (${savings.toFixed(1)}%)`;
  }

  getStats(): CSSOptimizerStats {
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
  fs: FileSystem = createFileSystem(),
): Promise<Map<string, CSSBundle>> {
  const manifestPath = join(outputDir, CSS_MANIFEST_FILENAME);
  let content: string;
  try {
    const info = fs.lstat ? await fs.lstat(manifestPath) : await fs.stat(manifestPath);
    if (
      !info.isFile ||
      info.isSymlink ||
      !Number.isSafeInteger(info.size) ||
      info.size < 0
    ) {
      throw new TypeError("CSS manifest must be a regular file");
    }
    if (info.size > MAX_CSS_MANIFEST_BYTES) {
      throw new TypeError(
        `CSS manifest exceeds ${MAX_CSS_MANIFEST_BYTES} bytes`,
      );
    }
    content = await fs.readTextFile(manifestPath);
    if (encoder.encode(content).length > MAX_CSS_MANIFEST_BYTES) {
      throw new TypeError(
        `CSS manifest exceeds ${MAX_CSS_MANIFEST_BYTES} bytes`,
      );
    }
  } catch (error) {
    if (isNotFoundError(error)) return new Map();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new TypeError("CSS manifest is not valid JSON", { cause: error });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new TypeError("CSS manifest must be a JSON object");
  }

  const entries = Object.entries(parsed);
  assertBundles(entries, false);
  for (const [key, bundle] of entries) {
    if (typeof bundle.content === "string") continue;
    const outputPath = getOutputPath(key, outputDir);
    try {
      const info = fs.lstat ? await fs.lstat(outputPath) : await fs.stat(outputPath);
      if (
        !info.isFile ||
        info.isSymlink ||
        !Number.isSafeInteger(info.size) ||
        info.size < 0 ||
        info.size > MAX_CSS_OUTPUT_FILE_BYTES
      ) {
        throw new TypeError(
          `Legacy CSS manifest output is invalid for ${JSON.stringify(key)}`,
        );
      }
      bundle.content = await fs.readTextFile(outputPath);
    } catch (error) {
      throw new TypeError(
        `Legacy CSS manifest output is missing for ${JSON.stringify(key)}`,
        { cause: error },
      );
    }
    if (encoder.encode(bundle.content).length !== bundle.minifiedSize) {
      throw new TypeError(
        `Legacy CSS manifest output size does not match ${JSON.stringify(key)}`,
      );
    }
  }
  assertBundles(entries, true);
  return new Map(
    entries.map(([key, bundle]) => [key, cloneBundle(bundle)]),
  );
}
