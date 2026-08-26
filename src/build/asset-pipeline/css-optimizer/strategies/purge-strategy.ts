import { extname, resolve } from "#veryfront/compat/path/index.ts";
import type { CSSPurgingEngine } from "#veryfront/extensions/css/index.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { hasControlCharacters } from "../../../utils/string-validation.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_PURGE_PATTERNS,
  MAX_CSS_PURGE_SAFELIST_ENTRIES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
  MAX_CSS_TOTAL_BYTES,
} from "../constants.ts";
import {
  inspectOwnProperties,
  isArrayValue,
  readOwnDataProperty,
  rejectUnknownOwnProperties,
  snapshotDenseDataArray,
} from "../data-snapshot.ts";
import {
  acquireConfiguredCSSPurging,
  assertCSSPurgingSession,
  createCSSPurgingSession,
  type CSSPurgingSession,
} from "../purging-engine.ts";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.ts";
import { extractSelectors, globFiles } from "../utils.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

export interface PurgeContentSource {
  path: string;
  raw: string;
  extension: string;
}

type ContentCollector = (
  patterns: string[],
) => Promise<PurgeContentSource[]>;

export interface PurgeStrategyDependencies {
  baseDir?: string;
  fs?: FileSystem;
  collectContent?: ContentCollector;
  purgingEngine?: CSSPurgingEngine;
}

function selectorToken(selector: string): string {
  return selector.startsWith(".") || selector.startsWith("#") ? selector.slice(1) : selector;
}

const encoder = new TextEncoder();
const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const setAdd = Set.prototype.add;
const setClear = Set.prototype.clear;
const setForEach = Set.prototype.forEach;
const setHas = Set.prototype.has;
const setSize = getOwnPropertyDescriptor(Set.prototype, "size")?.get;
const CONTENT_SOURCE_KEYS = ["path", "raw", "extension"] as const;

function isSafeBoundedString(
  value: unknown,
  maximumCharacters: number,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumCharacters &&
    !hasControlCharacters(value);
}

function setEntryCount(value: Set<unknown>): number {
  if (setSize === undefined) {
    throw new TypeError("Set size accessor is unavailable");
  }
  return apply(setSize, value, []) as number;
}

function validateSelectorEvidence(selectors: Set<string>): string[] {
  if (setEntryCount(selectors) > MAX_CSS_SELECTOR_TOKENS) {
    throw new TypeError(
      `CSS selector evidence must contain at most ${MAX_CSS_SELECTOR_TOKENS} entries`,
    );
  }
  const tokens: string[] = [];
  apply(setForEach, selectors, [(selector: unknown) => {
    if (
      !isSafeBoundedString(selector, MAX_CSS_SELECTOR_TOKEN_CHARACTERS) ||
      /\s/u.test(selector)
    ) {
      throw new TypeError("CSS selector evidence contains an unsafe token");
    }
    const token = selectorToken(selector);
    if (
      !isSafeBoundedString(token, MAX_CSS_SELECTOR_TOKEN_CHARACTERS) ||
      /\s/u.test(token)
    ) {
      throw new TypeError("CSS selector evidence contains an unsafe token");
    }
    tokens.push(token);
  }]);
  return tokens.sort(compareStrings);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (apply(setHas, seen, [value])) continue;
    apply(setAdd, seen, [value]);
    result[result.length] = value;
  }
  return result;
}

function validateContentSources(
  value: unknown,
): PurgeContentSource[] {
  const candidates = snapshotDenseDataArray(
    value,
    MAX_CSS_FILES,
    "CSS purge content",
  );

  let totalBytes = 0;
  const paths = new Set<string>();
  const sources: PurgeContentSource[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      isArrayValue(candidate, "CSS purge content source")
    ) {
      throw new TypeError("CSS purge content source is malformed");
    }
    const values = inspectOwnProperties(candidate, "CSS purge content source");
    rejectUnknownOwnProperties(
      values,
      CONTENT_SOURCE_KEYS,
      "CSS purge content source",
    );
    const path = readOwnDataProperty(
      values,
      "path",
      "CSS purge content source",
      true,
    );
    const raw = readOwnDataProperty(
      values,
      "raw",
      "CSS purge content source",
      true,
    );
    const extension = readOwnDataProperty(
      values,
      "extension",
      "CSS purge content source",
      true,
    );
    if (
      !isSafeBoundedString(path, MAX_PATH_LENGTH_CHARS) ||
      typeof raw !== "string" ||
      !isSafeBoundedString(extension, 32) ||
      !/^[A-Za-z0-9]+$/.test(extension)
    ) {
      throw new TypeError("CSS purge content source is malformed");
    }
    if (paths.has(path)) {
      throw new TypeError(`Duplicate CSS purge content source: ${path}`);
    }
    paths.add(path);

    const bytes = encoder.encode(raw).length;
    if (bytes > MAX_CSS_FILE_BYTES) {
      throw new TypeError(
        `CSS purge content exceeds ${MAX_CSS_FILE_BYTES} bytes: ${path}`,
      );
    }
    totalBytes += bytes;
    if (totalBytes > MAX_CSS_TOTAL_BYTES) {
      throw new TypeError(
        `CSS purge content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`,
      );
    }
    sources.push({
      path,
      raw,
      extension: extension.toLowerCase(),
    });
  }
  return sources;
}

export class PurgeStrategy implements CSSOptimizationStrategy {
  readonly name = "purge-css";
  readonly priority = 50;

  private readonly baseDir: string;
  private readonly fs: FileSystem;
  private readonly collectContentDependency: ContentCollector;
  private readonly purgingEngine: CSSPurgingEngine | undefined;
  private readonly usedSelectors = new Set<string>();
  private contentSources: PurgeContentSource[] = [];

  constructor(dependencies: PurgeStrategyDependencies = {}) {
    if (
      typeof dependencies !== "object" ||
      dependencies === null ||
      Array.isArray(dependencies)
    ) {
      throw new TypeError("Purge strategy dependencies must be an object");
    }
    if (
      dependencies.collectContent !== undefined &&
      typeof dependencies.collectContent !== "function"
    ) {
      throw new TypeError("Purge content collector must be a function");
    }
    this.baseDir = resolve(dependencies.baseDir ?? cwd());
    this.fs = dependencies.fs ?? createFileSystem();
    this.collectContentDependency = dependencies.collectContent ??
      ((patterns) => this.collectContent(patterns));
    this.purgingEngine = dependencies.purgingEngine;
  }

  canProcess(options: CSSOptimizationOptions): boolean {
    return options.enabled !== false && options.purge === true;
  }

  async analyzeContent(purgeContent: string[]): Promise<void> {
    const patterns = snapshotDenseDataArray(
      purgeContent,
      MAX_CSS_PURGE_PATTERNS,
      "CSS purgeContent",
    );
    if (
      patterns.length === 0 ||
      patterns.some((pattern) => !isSafeBoundedString(pattern, MAX_PATH_LENGTH_CHARS))
    ) {
      throw new TypeError(
        `CSS purgeContent must contain from 1 through ${MAX_CSS_PURGE_PATTERNS} patterns`,
      );
    }

    logger.debug("Analyzing content for CSS purging");
    const contentSources = validateContentSources(
      await this.collectContentDependency(patterns as string[]),
    );
    if (contentSources.length === 0) {
      throw new TypeError("CSS purgeContent patterns matched no files");
    }

    const usedSelectors = new Set<string>();
    for (const source of contentSources) {
      const { selectors } = extractSelectors(source.raw);
      apply(setForEach, selectors, [(selector: string) => {
        apply(setAdd, usedSelectors, [selector]);
        if (setEntryCount(usedSelectors) > MAX_CSS_SELECTOR_TOKENS) {
          throw new TypeError(
            `CSS selector evidence exceeds ${MAX_CSS_SELECTOR_TOKENS} entries`,
          );
        }
      }]);
    }
    validateSelectorEvidence(usedSelectors);
    this.contentSources = contentSources;
    apply(setClear, this.usedSelectors, []);
    apply(setForEach, usedSelectors, [(selector: string) => {
      apply(setAdd, this.usedSelectors, [selector]);
    }]);
    logger.debug(
      `Found ${setEntryCount(this.usedSelectors)} statically visible selectors`,
    );
  }

  async process(
    content: string,
    _filename: string,
    options: CSSOptimizationOptions,
    operationSession?: CSSPurgingSession,
  ): Promise<CSSProcessingResult> {
    if (typeof content !== "string") {
      throw new TypeError("CSS purge input must be a string");
    }
    const inputBytes = encoder.encode(content).length;
    if (inputBytes > MAX_CSS_FILE_BYTES) {
      throw new TypeError(`CSS purge input exceeds ${MAX_CSS_FILE_BYTES} bytes`);
    }
    if (this.contentSources.length === 0) {
      if (options.purgeContent?.length) {
        await this.analyzeContent(options.purgeContent);
      } else if (setEntryCount(this.usedSelectors) === 0) {
        throw new TypeError(
          "CSS purging requires non-empty purgeContent or an analyzed selector set",
        );
      }
    }

    const configuredSafelistValues = options.purgeSafelist === undefined
      ? []
      : snapshotDenseDataArray(
        options.purgeSafelist,
        MAX_CSS_PURGE_SAFELIST_ENTRIES,
        "CSS purgeSafelist",
      );
    if (
      configuredSafelistValues.length > MAX_CSS_PURGE_SAFELIST_ENTRIES ||
      configuredSafelistValues.some((entry) =>
        !isSafeBoundedString(entry, MAX_CSS_SELECTOR_TOKEN_CHARACTERS)
      )
    ) {
      throw new TypeError(
        `CSS purgeSafelist must contain at most ${MAX_CSS_PURGE_SAFELIST_ENTRIES} non-empty strings`,
      );
    }
    const configuredSafelist = configuredSafelistValues as string[];
    const configuredSafelistTokens = configuredSafelist.map(selectorToken);
    if (
      configuredSafelistTokens.some((entry) =>
        !isSafeBoundedString(entry, MAX_CSS_SELECTOR_TOKEN_CHARACTERS) ||
        /\s/u.test(entry)
      )
    ) {
      throw new TypeError("CSS purgeSafelist contains an unsafe selector token");
    }

    if (operationSession !== undefined) {
      assertCSSPurgingSession(operationSession);
    }
    const session = operationSession ?? this.createOperationSession();
    const selectorTokens = validateSelectorEvidence(this.usedSelectors);
    const safelist = uniqueStrings(
      this.contentSources.length === 0
        ? [...configuredSafelistTokens, ...selectorTokens]
        : configuredSafelistTokens,
    );
    const result = await session.run({
      content: this.contentSources.length > 0
        ? this.contentSources.map(({ raw, extension }) => ({
          raw,
          extension,
        }))
        : [{
          raw: selectorTokens.join(" "),
          extension: "html",
        }],
      css: content,
      safelist,
      includeRejectedCSS: false,
    });
    return { code: result.css, sourceMap: undefined };
  }

  getUsedSelectors(): Set<string> {
    return this.usedSelectors;
  }

  clearCache(): void {
    apply(setClear, this.usedSelectors, []);
    this.contentSources = [];
  }

  /** Capture exactly one configured provider for a complete purge operation. */
  createOperationSession(): CSSPurgingSession {
    return this.purgingEngine === undefined
      ? acquireConfiguredCSSPurging()
      : createCSSPurgingSession(this.purgingEngine);
  }

  private async collectContent(
    patterns: string[],
  ): Promise<PurgeContentSource[]> {
    const files = new Set<string>();
    for (const pattern of patterns) {
      for (
        const path of await globFiles(pattern, {
          baseDir: this.baseDir,
          fs: this.fs,
        })
      ) {
        files.add(path);
        if (files.size > MAX_CSS_FILES) {
          throw new TypeError(
            `CSS purge content exceeds ${MAX_CSS_FILES} files`,
          );
        }
      }
    }

    let totalBytes = 0;
    const sources: PurgeContentSource[] = [];
    for (const path of [...files].sort(compareStrings)) {
      const info = this.fs.lstat ? await this.fs.lstat(path) : await this.fs.stat(path);
      if (
        !info.isFile ||
        info.isSymlink ||
        !Number.isSafeInteger(info.size) ||
        info.size < 0
      ) {
        throw new TypeError(`CSS purge content must be a regular file: ${path}`);
      }
      if (info.size > MAX_CSS_FILE_BYTES) {
        throw new TypeError(
          `CSS purge content exceeds ${MAX_CSS_FILE_BYTES} bytes: ${path}`,
        );
      }
      const raw = await this.fs.readTextFile(path);
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
}
