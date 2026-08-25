/**
 * Shared test helper: activates the `@veryfront/ext-css-tailwind` extension so
 * core tests that exercise the Tailwind compile path can resolve the
 * `CSSProcessor` contract. That extension is `builtin-deferred` in
 * `first-party-defaults.ts`, so composing it here mirrors what a real install
 * has.
 *
 * This helper deliberately registers NOTHING ELSE. It used to also register a
 * no-op `CSSOptimizationEngine` whenever none was present, which quietly gave
 * every importing suite a capability that no shipped install has:
 * `ext-css-lightning` is `selection: "explicit", rootNpm: false`. The result
 * was that `css-compile.test.ts` and `build-executor.test.ts` stayed green
 * across 100+ steps while every single deploy failed with
 * `Missing extension for contract "CSSOptimizationEngine"`.
 *
 * The rule this encodes: a fixture must compose the extension set the product
 * actually ships. Over-composing turns a suite into a test of a configuration
 * no user has. A test that needs an optimiser must install one explicitly with
 * `installTestCSSOptimizationEngine` / `withTestCSSOptimizationEngine`, so the
 * dependency is visible at the call site.
 *
 * Import this module (for side effects) from any test that exercises the
 * Tailwind compile path via `getCompiler` / `generateTailwindCSS` /
 * `getProjectCSS`.
 *
 * E2E tests that boot the production server via `startProductionServer`
 * must call `registerTailwindExtension()` AFTER server start, because
 * bootstrap's `orchestrateExtensions` runs `teardownAll()` → `reset()`
 * which wipes the top-level registration done at import time.
 *
 * @module html/styles-builder/__tests__/css-processor-setup
 */

import { register as registerContract } from "#veryfront/extensions/contracts.ts";
import extTailwindFactory from "../../../../extensions/ext-css-tailwind/src/index.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export async function registerTailwindExtension(): Promise<void> {
  const ext = extTailwindFactory();
  const ctx = {
    config: {},
    logger: noopLogger,
    provide: (name: string, impl: unknown) => registerContract(name, impl),
    get: () => undefined,
    resolve: () => {
      throw new Error("resolve not used in setup");
    },
  };
  await ext.setup?.(ctx as never);
}

await registerTailwindExtension();
