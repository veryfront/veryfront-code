import { ensureError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { bundlerLogger as logger } from "#veryfront/utils";
import * as bundler from "veryfront/extensions/bundler";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

const MAX_CSS_PATH_CHARACTERS = 4_096;

/**
 * Compile CSS with the registered bundler's parser. Production minification is
 * intentionally parser-backed so strings, data URLs, calculations, and custom
 * property values cannot be corrupted by whitespace/comment regexes.
 */
export function bundleCss(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
): Promise<void> {
  return withSpan(
    "build.renderer.bundleCSS",
    async () => {
      try {
        if (
          typeof source.path !== "string" ||
          source.path.length === 0 ||
          source.path.length > MAX_CSS_PATH_CHARACTERS ||
          hasControlCharacters(source.path) ||
          typeof source.content !== "string"
        ) {
          throw new TypeError("CSS source requires a safe non-empty path and string content");
        }
        if (options.mode !== "development" && options.mode !== "production") {
          throw new TypeError("CSS bundle mode must be development or production");
        }

        let content = source.content;
        if (options.mode === "production") {
          const transformed = await bundler.transform(source.content, {
            loader: "css",
            minify: true,
            target: "es2020",
          });
          content = transformed.code.trim();
          result.warnings.push(...transformed.warnings);
        }

        result.outputs.set(source.path, {
          path: source.path,
          content,
          type: "css",
        });
        logger.debug(`Bundled CSS: ${source.path}`);
      } catch (error) {
        logger.error(`Failed to bundle CSS ${source.path}`, error);
        result.errors.push(ensureError(error));
      }
    },
    {
      "source.path": source.path,
      "options.mode": options.mode,
    },
  );
}

/**
 * CSS imports remain authored imports here. Import graph resolution belongs to
 * the caller's bundling stage rather than this single-source transform.
 */
export function processCssImports(css: string, _fromPath: string): string {
  return css;
}

function skipComment(css: string, start: number): number {
  const end = css.indexOf("*/", start + 2);
  return end === -1 ? css.length : end + 2;
}

function skipString(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    if (css[index] === "\\") {
      index += 2;
      continue;
    }
    if (css[index] === quote) return index + 1;
    index++;
  }
  return css.length;
}

function isCustomPropertyNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return character === "-" ||
    character === "_" ||
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code >= 0x80;
}

function readCustomPropertyValue(
  css: string,
  start: number,
): { value: string; next: number } {
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let index = start;

  while (index < css.length) {
    const character = css[index]!;
    if (character === "/" && css[index + 1] === "*") {
      index = skipComment(css, index);
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipString(css, index);
      continue;
    }
    if (character === "(") parentheses++;
    else if (character === ")" && parentheses > 0) parentheses--;
    else if (character === "[") brackets++;
    else if (character === "]" && brackets > 0) brackets--;
    else if (character === "{") braces++;
    else if (character === "}" && braces > 0) braces--;
    else if (
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0 &&
      (character === ";" || character === "}")
    ) {
      break;
    }
    index++;
  }

  return {
    value: css.slice(start, index).trim(),
    next: index < css.length && css[index] === ";" ? index + 1 : index,
  };
}

/** Extract CSS custom-property declarations without matching strings/comments. */
export function extractCssVariables(css: string): Record<string, string> {
  if (typeof css !== "string") {
    throw new TypeError("CSS content must be a string");
  }

  const variables: Record<string, string> = {};
  let index = 0;

  while (index < css.length) {
    const character = css[index]!;
    if (character === "/" && css[index + 1] === "*") {
      index = skipComment(css, index);
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipString(css, index);
      continue;
    }
    if (character !== "-" || css[index + 1] !== "-") {
      index++;
      continue;
    }

    const nameStart = index + 2;
    let nameEnd = nameStart;
    while (
      nameEnd < css.length &&
      isCustomPropertyNameCharacter(css[nameEnd]!)
    ) {
      nameEnd++;
    }
    if (nameEnd === nameStart) {
      index += 2;
      continue;
    }

    let colon = nameEnd;
    while (colon < css.length && /\s/.test(css[colon]!)) colon++;
    if (css[colon] !== ":") {
      index = nameEnd;
      continue;
    }

    const { value, next } = readCustomPropertyValue(css, colon + 1);
    if (value.length > 0) {
      Object.defineProperty(variables, css.slice(nameStart, nameEnd), {
        value,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
    index = Math.max(next, colon + 1);
  }

  return variables;
}
