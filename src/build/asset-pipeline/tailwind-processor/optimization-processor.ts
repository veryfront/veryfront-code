import type {
  CSSOptimizationEngine,
  CSSOptimizationResult,
} from "#veryfront/extensions/css/index.ts";
import {
  acquireConfiguredCSSOptimization,
  createCSSOptimizationSession,
} from "../css-optimizer/optimization-engine.ts";
import type { CSSOptimizationProcessOptions } from "./types.ts";

/**
 * Run the provider-neutral CSS optimization stage used by the legacy batch
 * processor. Missing or failing providers are surfaced without substitution.
 */
export function processWithCSSOptimization(
  css: string,
  options: CSSOptimizationProcessOptions,
  engine?: CSSOptimizationEngine,
): CSSOptimizationResult {
  const session = engine === undefined
    ? acquireConfiguredCSSOptimization()
    : createCSSOptimizationSession(engine);
  return session.run({
    css,
    sourcePath: options.sourcePath,
    minify: options.minify ?? true,
    sourceMap: options.sourceMap ?? false,
  });
}
