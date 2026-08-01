import { DEPENDENCY_MISSING } from "#veryfront/errors";
import type { CSSOptimizationEngine } from "#veryfront/extensions/css/index.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_PURGE_SAFELIST_ENTRIES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_TOTAL_OUTPUT_BYTES,
  PURGE_CSS_MODULE_SPECIFIER,
} from "./constants.ts";
import type { CriticalCSSResult, CSSOptimizationOptions } from "./types/index.ts";
import {
  acquireConfiguredCSSOptimization,
  createCSSOptimizationSession,
} from "./optimization-engine.ts";

interface CriticalPurgeResult {
  css: string;
  rejectedCss?: string;
}

interface CriticalPurgeCSSModule {
  PurgeCSS: new () => {
    purge(options: {
      content: Array<{ raw: string; extension: string }>;
      css: Array<{ raw: string }>;
      rejectedCss: true;
      safelist?: string[];
    }): Promise<CriticalPurgeResult[]>;
  };
}

const encoder = new TextEncoder();
let purgeCSSModule: Promise<CriticalPurgeCSSModule> | null = null;

function safelistToken(value: string): string {
  return value.startsWith(".") || value.startsWith("#") ? value.slice(1) : value;
}

async function loadPurgeCSS(): Promise<CriticalPurgeCSSModule> {
  const pending = purgeCSSModule ??= import(PURGE_CSS_MODULE_SPECIFIER).then(
    (module) => {
      if (!module || typeof module.PurgeCSS !== "function") {
        throw new TypeError("PurgeCSS module did not export PurgeCSS");
      }
      return module;
    },
  );
  try {
    return await pending;
  } catch (error) {
    if (purgeCSSModule === pending) purgeCSSModule = null;
    throw DEPENDENCY_MISSING.create({
      detail: `Critical CSS extraction requires ${PURGE_CSS_MODULE_SPECIFIER}`,
      cause: error,
    });
  }
}

export function extractCriticalCSS(
  cssPath: string,
  htmlContent: string,
  options: CSSOptimizationOptions,
  optimizationEngine?: CSSOptimizationEngine,
): Promise<CriticalCSSResult> {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError("Critical CSS options must be an object");
  }
  if (
    typeof cssPath !== "string" ||
    cssPath.length === 0 ||
    cssPath.length > MAX_PATH_LENGTH_CHARS ||
    hasControlCharacters(cssPath)
  ) {
    throw new TypeError("Critical CSS input path must be a safe non-empty path");
  }
  if (options.minify !== undefined && typeof options.minify !== "boolean") {
    throw new TypeError("Critical CSS minify must be a boolean");
  }
  const shouldMinify = options.minify ?? true;
  const optimizationSession = shouldMinify
    ? (optimizationEngine === undefined
      ? acquireConfiguredCSSOptimization()
      : createCSSOptimizationSession(optimizationEngine))
    : undefined;

  return withSpan(
    "build.asset.extractCriticalCSS",
    async (): Promise<CriticalCSSResult> => {
      if (typeof htmlContent !== "string") {
        throw new TypeError("Critical CSS HTML content must be a string");
      }
      if (encoder.encode(htmlContent).length > MAX_CSS_FILE_BYTES) {
        throw new TypeError(
          `Critical CSS HTML content exceeds ${MAX_CSS_FILE_BYTES} bytes`,
        );
      }
      if (
        options.purgeSafelist !== undefined &&
        !Array.isArray(options.purgeSafelist)
      ) {
        throw new TypeError("Critical CSS safelist must be an array");
      }
      const safelist = Array.from(options.purgeSafelist ?? []);
      if (
        safelist.length > MAX_CSS_PURGE_SAFELIST_ENTRIES ||
        safelist.some((entry) =>
          typeof entry !== "string" ||
          entry.length === 0 ||
          entry.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
          hasControlCharacters(entry) ||
          /\s/u.test(entry)
        )
      ) {
        throw new TypeError(
          `Critical CSS safelist must contain at most ${MAX_CSS_PURGE_SAFELIST_ENTRIES} non-empty strings`,
        );
      }
      const safelistTokens = safelist.map(safelistToken);
      if (
        safelistTokens.some((entry) =>
          entry.length === 0 ||
          entry.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
          hasControlCharacters(entry)
        )
      ) {
        throw new TypeError("Critical CSS safelist contains an unsafe selector token");
      }

      logger.debug(`Extracting critical CSS from ${cssPath}`);
      const fs = createFileSystem();
      let info;
      try {
        info = fs.lstat ? await fs.lstat(cssPath) : await fs.stat(cssPath);
      } catch (error) {
        if (isNotFoundError(error)) {
          throw new TypeError(`Critical CSS input does not exist: ${cssPath}`, {
            cause: error,
          });
        }
        throw error;
      }
      if (
        !info.isFile ||
        info.isSymlink ||
        !Number.isSafeInteger(info.size) ||
        info.size < 0
      ) {
        throw new TypeError("Critical CSS input must be a regular file");
      }
      if (info.size > MAX_CSS_FILE_BYTES) {
        throw new TypeError(
          `Critical CSS input exceeds ${MAX_CSS_FILE_BYTES} bytes`,
        );
      }
      const css = await fs.readTextFile(cssPath);
      if (encoder.encode(css).length > MAX_CSS_FILE_BYTES) {
        throw new TypeError(
          `Critical CSS input exceeds ${MAX_CSS_FILE_BYTES} bytes`,
        );
      }

      const module = await loadPurgeCSS();
      const results = await new module.PurgeCSS().purge({
        content: [{ raw: htmlContent, extension: "html" }],
        css: [{ raw: css }],
        rejectedCss: true,
        safelist: safelistTokens,
      });
      const result = results[0];
      if (
        results.length !== 1 ||
        !result ||
        typeof result.css !== "string" ||
        typeof result.rejectedCss !== "string"
      ) {
        throw new TypeError("PurgeCSS returned an invalid critical CSS result");
      }

      const critical = optimizationSession === undefined ? result.css : optimizationSession.run({
        css: result.css,
        sourcePath: "critical.css",
        minify: true,
        sourceMap: false,
      }).css;
      const remaining = optimizationSession === undefined
        ? result.rejectedCss
        : optimizationSession.run({
          css: result.rejectedCss,
          sourcePath: "remaining.css",
          minify: true,
          sourceMap: false,
        }).css;
      const criticalSize = encoder.encode(critical).length;
      const remainingSize = encoder.encode(remaining).length;
      if (
        criticalSize > MAX_CSS_OUTPUT_FILE_BYTES ||
        remainingSize > MAX_CSS_OUTPUT_FILE_BYTES ||
        criticalSize + remainingSize > MAX_CSS_TOTAL_OUTPUT_BYTES
      ) {
        throw new TypeError("Critical CSS output exceeds the configured resource limits");
      }
      return {
        critical,
        remaining,
        criticalSize,
        remainingSize,
      };
    },
    {
      "css.path": cssPath,
      "css.minify": shouldMinify,
    },
  );
}
