/** Test-only explicit composition helpers for CSSOptimizationEngine. */

import type {
  CSSOptimizationEngine,
  CSSOptimizationRequest,
  CSSOptimizationResult,
} from "../../src/extensions/css/index.ts";
import { CSSOptimizationEngineName } from "../../src/extensions/css/index.ts";
import { register, tryResolve, unregister } from "../../src/extensions/contracts.ts";

export function createTestCSSSourceMap(sourcePath: string): string {
  return JSON.stringify({
    version: 3,
    sources: [sourcePath],
    names: [],
    mappings: "AAAA",
  });
}

export function createTestCSSOptimizationEngine(
  optimize: (
    request: CSSOptimizationRequest,
  ) => CSSOptimizationResult = (request) => ({
    css: request.css,
    ...(request.sourceMap ? { sourceMap: createTestCSSSourceMap(request.sourcePath) } : {}),
  }),
  cacheIdentity = "test-css-optimization-engine@1",
): CSSOptimizationEngine {
  return { cacheIdentity, optimize };
}

/** Explicitly compose a test engine and return an idempotent restoration callback. */
export function installTestCSSOptimizationEngine(
  engine: CSSOptimizationEngine = createTestCSSOptimizationEngine(),
): () => void {
  const previous = tryResolve<CSSOptimizationEngine>(CSSOptimizationEngineName);
  unregister(CSSOptimizationEngineName);
  register(CSSOptimizationEngineName, engine);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unregister(CSSOptimizationEngineName);
    if (previous !== undefined) {
      register(CSSOptimizationEngineName, previous);
    }
  };
}

export async function withTestCSSOptimizationEngine<T>(
  engine: CSSOptimizationEngine,
  run: () => T | Promise<T>,
): Promise<T> {
  const restore = installTestCSSOptimizationEngine(engine);
  try {
    return await run();
  } finally {
    restore();
  }
}
