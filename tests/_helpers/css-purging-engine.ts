/** Test-only explicit composition helpers for CSSPurgingEngine. */

import type {
  CSSPurgingEngine,
  CSSPurgingRequest,
  CSSPurgingResult,
} from "../../src/extensions/css/index.ts";
import { CSSPurgingEngineName } from "../../src/extensions/css/index.ts";
import { register, tryResolve, unregister } from "../../src/extensions/contracts.ts";

export function createTestCSSPurgingEngine(
  purge: (
    request: CSSPurgingRequest,
  ) => Promise<CSSPurgingResult> = (request) =>
    Promise.resolve({
      css: request.css,
      ...(request.includeRejectedCSS ? { rejectedCSS: "" } : {}),
    }),
  cacheIdentity = "test-css-purging-engine@1",
): CSSPurgingEngine {
  return { cacheIdentity, purge };
}

/** Explicitly compose a test engine and return an idempotent restoration callback. */
export function installTestCSSPurgingEngine(
  engine: CSSPurgingEngine = createTestCSSPurgingEngine(),
): () => void {
  const previous = tryResolve<CSSPurgingEngine>(CSSPurgingEngineName);
  unregister(CSSPurgingEngineName);
  register(CSSPurgingEngineName, engine);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unregister(CSSPurgingEngineName);
    if (previous !== undefined) register(CSSPurgingEngineName, previous);
  };
}

export async function withTestCSSPurgingEngine<T>(
  engine: CSSPurgingEngine,
  run: () => Promise<T> | T,
): Promise<T> {
  const restore = installTestCSSPurgingEngine(engine);
  try {
    return await run();
  } finally {
    restore();
  }
}
