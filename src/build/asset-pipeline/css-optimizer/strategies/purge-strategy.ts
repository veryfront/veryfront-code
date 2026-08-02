import { extname, resolve } from "#veryfront/compat/path/index.ts";
import { DEPENDENCY_MISSING } from "#veryfront/errors";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { hasControlCharacters } from "../../../utils/string-validation.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_PURGE_PATTERNS,
  MAX_CSS_PURGE_SAFELIST_ENTRIES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
  MAX_CSS_TOTAL_BYTES,
  PURGE_CSS_MODULE_SPECIFIER,
} from "../constants.ts";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
} from "../types/index.ts";
import { extractSelectors, globFiles } from "../utils.ts";

interface PurgeCSSResult {
  css: string;
}

interface PurgeCSSInstance {
  purge(options: {
    content: Array<{ raw: string; extension: string }>;
    css: Array<{ raw: string }>;
    safelist?: string[];
  }): Promise<PurgeCSSResult[]>;
}

interface PurgeCSSModule {
  PurgeCSS: new () => PurgeCSSInstance;
}

export interface PurgeContentSource {
  path: string;
  raw: string;
  extension: string;
}

type PurgeCSSLoader = () => Promise<PurgeCSSModule>;
type ContentCollector = (
  patterns: string[],
) => Promise<PurgeContentSource[]>;

export interface PurgeStrategyDependencies {
  baseDir?: string;
  fs?: FileSystem;
  collectContent?: ContentCollector;
  loadPurgeCSS?: PurgeCSSLoader;
}

function defaultPurgeCSSLoader(): Promise<PurgeCSSModule> {
  return import(PURGE_CSS_MODULE_SPECIFIER);
}

function selectorToken(selector: string): string {
  return selector.startsWith(".") || selector.startsWith("#") ? selector.slice(1) : selector;
}

const encoder = new TextEncoder();

function isSafeBoundedString(
  value: unknown,
  maximumCharacters: number,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumCharacters &&
    !hasControlCharacters(value);
}

function validateSelectorEvidence(selectors: Set<string>): string[] {
  if (!(selectors instanceof Set) || selectors.size > MAX_CSS_SELECTOR_TOKENS) {
    throw new TypeError(
      `CSS selector evidence must contain at most ${MAX_CSS_SELECTOR_TOKENS} entries`,
    );
  }
  const tokens = [];
  for (const selector of selectors) {
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
  }
  return tokens.sort();
}

function validateContentSources(
  value: unknown,
): PurgeContentSource[] {
  if (!Array.isArray(value) || value.length > MAX_CSS_FILES) {
    throw new TypeError(
      `CSS purge content must contain at most ${MAX_CSS_FILES} sources`,
    );
  }

  let totalBytes = 0;
  const paths = new Set<string>();
  const sources: PurgeContentSource[] = [];
  for (let index = 0; index < value.length; index++) {
    const candidate: unknown = value[index];
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new TypeError("CSS purge content source is malformed");
    }
    const source = candidate as Partial<PurgeContentSource>;
    if (
      !isSafeBoundedString(source.path, MAX_PATH_LENGTH_CHARS) ||
      typeof source.raw !== "string" ||
      !isSafeBoundedString(source.extension, 32) ||
      !/^[A-Za-z0-9]+$/.test(source.extension)
    ) {
      throw new TypeError("CSS purge content source is malformed");
    }
    if (paths.has(source.path)) {
      throw new TypeError(`Duplicate CSS purge content source: ${source.path}`);
    }
    paths.add(source.path);

    const bytes = encoder.encode(source.raw).length;
    if (bytes > MAX_CSS_FILE_BYTES) {
      throw new TypeError(
        `CSS purge content exceeds ${MAX_CSS_FILE_BYTES} bytes: ${source.path}`,
      );
    }
    totalBytes += bytes;
    if (totalBytes > MAX_CSS_TOTAL_BYTES) {
      throw new TypeError(
        `CSS purge content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`,
      );
    }
    sources.push({
      path: source.path,
      raw: source.raw,
      extension: source.extension.toLowerCase(),
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
  private readonly loadPurgeCSSDependency: PurgeCSSLoader;
  private readonly usedSelectors = new Set<string>();
  private contentSources: PurgeContentSource[] = [];
  private purgeCSSModule: Promise<PurgeCSSModule> | null = null;
  private purgeCSSLoadGeneration = 0;

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
    if (
      dependencies.loadPurgeCSS !== undefined &&
      typeof dependencies.loadPurgeCSS !== "function"
    ) {
      throw new TypeError("PurgeCSS loader must be a function");
    }
    this.baseDir = resolve(dependencies.baseDir ?? cwd());
    this.fs = dependencies.fs ?? createFileSystem();
    this.collectContentDependency = dependencies.collectContent ??
      ((patterns) => this.collectContent(patterns));
    this.loadPurgeCSSDependency = dependencies.loadPurgeCSS ??
      defaultPurgeCSSLoader;
  }

  canProcess(options: CSSOptimizationOptions): boolean {
    return options.enabled !== false && options.purge === true;
  }

  async analyzeContent(purgeContent: string[]): Promise<void> {
    if (
      !Array.isArray(purgeContent) ||
      purgeContent.length === 0 ||
      purgeContent.length > MAX_CSS_PURGE_PATTERNS ||
      Array.from(purgeContent).some((pattern) =>
        !isSafeBoundedString(pattern, MAX_PATH_LENGTH_CHARS)
      )
    ) {
      throw new TypeError(
        `CSS purgeContent must contain from 1 through ${MAX_CSS_PURGE_PATTERNS} patterns`,
      );
    }

    logger.debug("Analyzing content for CSS purging");
    const contentSources = validateContentSources(
      await this.collectContentDependency([...purgeContent]),
    );
    if (contentSources.length === 0) {
      throw new TypeError("CSS purgeContent patterns matched no files");
    }

    const usedSelectors = new Set<string>();
    for (const source of contentSources) {
      const { selectors } = extractSelectors(source.raw);
      for (const selector of selectors) {
        usedSelectors.add(selector);
        if (usedSelectors.size > MAX_CSS_SELECTOR_TOKENS) {
          throw new TypeError(
            `CSS selector evidence exceeds ${MAX_CSS_SELECTOR_TOKENS} entries`,
          );
        }
      }
    }
    validateSelectorEvidence(usedSelectors);
    this.contentSources = contentSources;
    this.usedSelectors.clear();
    for (const selector of usedSelectors) this.usedSelectors.add(selector);
    logger.debug(`Found ${this.usedSelectors.size} statically visible selectors`);
  }

  async process(
    content: string,
    _filename: string,
    options: CSSOptimizationOptions,
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
      } else if (this.usedSelectors.size === 0) {
        throw new TypeError(
          "CSS purging requires non-empty purgeContent or an analyzed selector set",
        );
      }
    }

    if (
      options.purgeSafelist !== undefined &&
      !Array.isArray(options.purgeSafelist)
    ) {
      throw new TypeError("CSS purgeSafelist must be an array");
    }
    const configuredSafelist = Array.from(options.purgeSafelist ?? []);
    if (
      configuredSafelist.length > MAX_CSS_PURGE_SAFELIST_ENTRIES ||
      configuredSafelist.some((entry) =>
        !isSafeBoundedString(entry, MAX_CSS_SELECTOR_TOKEN_CHARACTERS)
      )
    ) {
      throw new TypeError(
        `CSS purgeSafelist must contain at most ${MAX_CSS_PURGE_SAFELIST_ENTRIES} non-empty strings`,
      );
    }
    const configuredSafelistTokens = configuredSafelist.map(selectorToken);
    if (
      configuredSafelistTokens.some((entry) =>
        !isSafeBoundedString(entry, MAX_CSS_SELECTOR_TOKEN_CHARACTERS) ||
        /\s/u.test(entry)
      )
    ) {
      throw new TypeError("CSS purgeSafelist contains an unsafe selector token");
    }

    const module = await this.loadPurgeCSS();
    const selectorTokens = validateSelectorEvidence(this.usedSelectors);
    const safelist = [
      ...new Set([
        ...configuredSafelistTokens,
        ...(this.contentSources.length === 0 ? selectorTokens : []),
      ]),
    ];
    const results = await new module.PurgeCSS().purge({
      content: this.contentSources.length > 0
        ? this.contentSources.map(({ raw, extension }) => ({
          raw,
          extension,
        }))
        : [{
          raw: selectorTokens.join(" "),
          extension: "html",
        }],
      css: [{ raw: content }],
      safelist,
    });
    if (
      results.length !== 1 ||
      typeof results[0]?.css !== "string"
    ) {
      throw new TypeError("PurgeCSS returned an invalid result");
    }
    if (encoder.encode(results[0].css).length > MAX_CSS_OUTPUT_FILE_BYTES) {
      throw new TypeError(
        `PurgeCSS output exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} bytes`,
      );
    }
    return { code: results[0].css, sourceMap: undefined };
  }

  getUsedSelectors(): Set<string> {
    return this.usedSelectors;
  }

  clearCache(): void {
    this.usedSelectors.clear();
    this.contentSources = [];
  }

  private async loadPurgeCSS(): Promise<PurgeCSSModule> {
    if (this.purgeCSSModule) return await this.purgeCSSModule;

    const generation = ++this.purgeCSSLoadGeneration;
    const pending = (async () => {
      try {
        const module = await this.loadPurgeCSSDependency();
        if (!module || typeof module.PurgeCSS !== "function") {
          throw new TypeError("PurgeCSS module did not export PurgeCSS");
        }
        return module;
      } catch (error) {
        throw DEPENDENCY_MISSING.create({
          detail: `CSS purging requires ${PURGE_CSS_MODULE_SPECIFIER}`,
          cause: error,
        });
      }
    })();
    this.purgeCSSModule = pending;
    try {
      return await pending;
    } catch (error) {
      if (this.purgeCSSLoadGeneration === generation) this.purgeCSSModule = null;
      throw error;
    }
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
    for (const path of [...files].sort()) {
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
