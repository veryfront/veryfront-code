import { type CSSPurgingEngine, CSSPurgingEngineName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { PurgeCSSPurgingEngine } from "../../extensions/ext-css-purgecss/src/index.ts";

export function createTestCSSPurgingEngine(): CSSPurgingEngine {
  return new PurgeCSSPurgingEngine();
}

export async function withTestCSSPurgingEngine<T>(
  run: () => Promise<T> | T,
): Promise<T> {
  const previous = tryResolve<CSSPurgingEngine>(CSSPurgingEngineName);
  unregister(CSSPurgingEngineName);
  register(CSSPurgingEngineName, createTestCSSPurgingEngine());
  try {
    return await run();
  } finally {
    unregister(CSSPurgingEngineName);
    if (previous !== undefined) register(CSSPurgingEngineName, previous);
  }
}
