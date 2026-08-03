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
} from "./constants.ts";
import { snapshotDenseDataArray } from "./data-snapshot.ts";
import {
  acquireConfiguredCSSPurging,
  assertCSSPurgingSession,
  type CSSPurgingSession,
} from "./purging-engine.ts";
import type { CriticalCSSResult, CSSOptimizationOptions } from "./types/index.ts";
import {
  acquireConfiguredCSSOptimization,
  createCSSOptimizationSession,
} from "./optimization-engine.ts";

const encoder = new TextEncoder();

/** Explicit provider dependencies for one critical-CSS extraction. */
export interface CriticalCSSDependencies {
  readonly optimizationEngine?: CSSOptimizationEngine;
  readonly purgingSession?: CSSPurgingSession;
}

function snapshotDependencies(
  value: CriticalCSSDependencies,
): CriticalCSSDependencies {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Critical CSS dependencies must be an object");
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError("Critical CSS dependencies could not be inspected", {
      cause,
    });
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key !== "optimizationEngine" && key !== "purgingSession") {
      throw new TypeError("Critical CSS dependencies contain unsupported properties");
    }
  }
  const read = (key: "optimizationEngine" | "purgingSession"): unknown => {
    const descriptor = descriptors[key];
    if (descriptor === undefined) return undefined;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`Critical CSS dependency ${key} must be a data property`);
    }
    return descriptor.value;
  };
  return Object.freeze({
    optimizationEngine: read("optimizationEngine") as CSSOptimizationEngine | undefined,
    purgingSession: read("purgingSession") as CSSPurgingSession | undefined,
  });
}

function safelistToken(value: string): string {
  return value.startsWith(".") || value.startsWith("#") ? value.slice(1) : value;
}

export function extractCriticalCSS(
  cssPath: string,
  htmlContent: string,
  options: CSSOptimizationOptions,
  dependencies: CriticalCSSDependencies = {},
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
  const capturedDependencies = snapshotDependencies(dependencies);
  const optimizationSession = shouldMinify
    ? (capturedDependencies.optimizationEngine === undefined
      ? acquireConfiguredCSSOptimization()
      : createCSSOptimizationSession(capturedDependencies.optimizationEngine))
    : undefined;
  if (capturedDependencies.purgingSession !== undefined) {
    assertCSSPurgingSession(capturedDependencies.purgingSession);
  }
  const purgingSession = capturedDependencies.purgingSession ?? acquireConfiguredCSSPurging();

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
      const safelistValues = options.purgeSafelist === undefined ? [] : snapshotDenseDataArray(
        options.purgeSafelist,
        MAX_CSS_PURGE_SAFELIST_ENTRIES,
        "Critical CSS safelist",
      );
      if (
        safelistValues.length > MAX_CSS_PURGE_SAFELIST_ENTRIES ||
        safelistValues.some((entry) =>
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
      const safelist = safelistValues as string[];
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

      const result = await purgingSession.run({
        content: [{ raw: htmlContent, extension: "html" }],
        css,
        includeRejectedCSS: true,
        safelist: safelistTokens,
      });
      if (result.rejectedCSS === undefined) {
        throw new TypeError("CSS purging engine omitted rejected CSS");
      }

      const critical = optimizationSession === undefined ? result.css : optimizationSession.run({
        css: result.css,
        sourcePath: "critical.css",
        minify: true,
        sourceMap: false,
      }).css;
      const remaining = optimizationSession === undefined
        ? result.rejectedCSS
        : optimizationSession.run({
          css: result.rejectedCSS,
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
