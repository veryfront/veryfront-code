/**
 * Shared test helper: activates the `@veryfront/ext-css-tailwind` extension so
 * core tests that exercise the Tailwind compile path can resolve the
 * `CSSProcessor` contract and, for tests that dynamically load plugins
 * from esm.sh, find the `__tailwindPluginShim` / `__tailwindDefaultThemeShim`
 * / `__tailwindColorsShim` globals that plugin-loader rewrites plugin
 * bundle imports against.
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
