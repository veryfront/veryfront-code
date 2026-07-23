import { ensureError } from "#veryfront/errors";
import { withSpanSync } from "#veryfront/observability/tracing/otlp-setup.ts";
import { bundlerLogger as logger } from "#veryfront/utils";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";
import { minifyCSSLexically } from "../../utils/css-minifier.ts";

export function bundleCss(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
): void {
  withSpanSync(
    "build.renderer.bundleCSS",
    () => {
      try {
        const processedCss = options.mode === "production"
          ? minifyCss(source.content)
          : source.content;

        result.outputs.set(source.path, {
          path: source.path,
          content: processedCss,
          type: "css",
        });

        logger.debug("Bundled CSS source");
      } catch (error) {
        logger.error("Failed to bundle CSS source");
        result.errors.push(ensureError(error));
      }
    },
    {
      "options.mode": options.mode,
    },
  );
}

function minifyCss(css: string): string {
  return minifyCSSLexically(css);
}

export function extractCssVariables(css: string): Record<string, string> {
  const variables: Record<string, string> = {};
  let index = 0;

  while (index < css.length) {
    if (css[index] === "/" && css[index + 1] === "*") {
      const commentEnd = css.indexOf("*/", index + 2);
      index = commentEnd === -1 ? css.length : commentEnd + 2;
      continue;
    }
    if (css[index] !== "-" || css[index + 1] !== "-") {
      index++;
      continue;
    }

    const nameStart = index + 2;
    let cursor = nameStart;
    while (cursor < css.length && /[a-zA-Z0-9_-]/.test(css[cursor] ?? "")) cursor++;
    const name = css.slice(nameStart, cursor);
    while (cursor < css.length && /\s/.test(css[cursor] ?? "")) cursor++;
    if (!name || css[cursor] !== ":") {
      index = cursor + 1;
      continue;
    }

    const valueStart = ++cursor;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let parenthesisDepth = 0;
    let bracketDepth = 0;
    while (cursor < css.length) {
      const char = css[cursor] ?? "";
      const next = css[cursor + 1] ?? "";
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        cursor++;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        cursor++;
        continue;
      }
      if (char === "/" && next === "*") {
        const commentEnd = css.indexOf("*/", cursor + 2);
        cursor = commentEnd === -1 ? css.length : commentEnd + 2;
        continue;
      }
      if (char === "(") parenthesisDepth++;
      else if (char === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      else if (char === "[") bracketDepth++;
      else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (
        (char === ";" || char === "}") && parenthesisDepth === 0 && bracketDepth === 0
      ) break;
      cursor++;
    }

    const value = css.slice(valueStart, cursor).trim();
    if (value) variables[name] = value;
    index = cursor + 1;
  }

  return variables;
}
