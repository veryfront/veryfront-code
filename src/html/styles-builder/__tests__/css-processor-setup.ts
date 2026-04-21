/**
 * Shared test helper: activates the `@veryfront/ext-tailwind` extension so
 * core tests that exercise the Tailwind compile path can resolve the
 * `CSSProcessor` contract and — for tests that dynamically load plugins
 * from esm.sh — find the `__tailwindPluginShim` / `__tailwindDefaultThemeShim`
 * / `__tailwindColorsShim` globals that plugin-loader rewrites plugin
 * bundle imports against.
 *
 * Import this module (for side effects) from any test that exercises the
 * Tailwind compile path via `getCompiler` / `generateTailwindCSS` /
 * `getProjectCSS`.
 *
 * @module html/styles-builder/__tests__/css-processor-setup
 */

import { register as registerContract } from "#veryfront/extensions/contracts.ts";
import extTailwindFactory from "../../../../extensions/ext-tailwind/src/index.ts";

const ext = extTailwindFactory();
const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
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
