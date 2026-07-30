/** Test-only explicit composition helpers for CSSProcessor. */

import type { CSSProcessor } from "../../src/extensions/css/index.ts";
import { CSSProcessorName } from "../../src/extensions/css/index.ts";
import { register, tryResolve, unregister } from "../../src/extensions/contracts.ts";

export function createTestCSSProcessor(
  cacheIdentity = "test-css-processor@1",
  defaultStylesheet = "",
): CSSProcessor {
  return {
    cacheIdentity,
    defaultStylesheet,
    compile(stylesheet) {
      return Promise.resolve({ build: () => stylesheet });
    },
  };
}

/** Explicitly compose a test processor and return an idempotent restoration callback. */
export function installTestCSSProcessor(
  processor: CSSProcessor = createTestCSSProcessor(),
): () => void {
  const previous = tryResolve<CSSProcessor>(CSSProcessorName);
  unregister(CSSProcessorName);
  register(CSSProcessorName, processor);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unregister(CSSProcessorName);
    if (previous !== undefined) {
      register(CSSProcessorName, previous);
    }
  };
}
