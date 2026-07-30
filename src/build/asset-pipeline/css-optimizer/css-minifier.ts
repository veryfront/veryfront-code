import {
  acquireConfiguredCSSOptimization,
  type CSSOptimizationSession,
} from "./optimization-engine.ts";
import { assertBalancedCssSyntax } from "../css-syntax.ts";

/** Minify CSS with the explicitly registered parser-backed optimization engine. */
export async function minifyCSS(
  css: string,
  session?: CSSOptimizationSession,
): Promise<string> {
  if (typeof css !== "string") {
    throw new TypeError("CSS content must be a string");
  }
  assertBalancedCssSyntax(css, "Generated CSS");

  const result = (session ?? acquireConfiguredCSSOptimization()).run({
    css,
    sourcePath: "generated.css",
    minify: true,
    sourceMap: false,
  });
  return result.css.trim();
}
