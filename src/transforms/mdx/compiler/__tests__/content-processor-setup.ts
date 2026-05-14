/**
 * Shared test helper: activates the `@veryfront/ext-transform-mdx` extension so core
 * tests that exercise the MDX / Markdown compile paths can resolve the
 * `ContentProcessor` contract.
 *
 * Importing this module runs `registerExtMdx()` once for its side effect,
 * which covers tests that simply import the helper. Call `registerExtMdx()`
 * again after any operation that resets the contract registry. For example, after
 * `bootstrap.setupAll` / `teardownAll` (which wipe registrations via
 * `reset()`), after `startProductionServer` / `startDevServer`, or after
 * `resetAllTestState()` in integration test helpers.
 *
 * @module transforms/mdx/compiler/__tests__/content-processor-setup
 */

import { register as registerContract } from "#veryfront/extensions/contracts.ts";
import extMdxFactory from "../../../../../extensions/ext-transform-mdx/src/index.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Activate the `@veryfront/ext-transform-mdx` extension by running its `setup` hook
 * against a minimal context that forwards `provide()` to the core contract
 * registry. Safe to call repeatedly: extension setup just re-registers
 * contracts, which overwrite any prior entry.
 */
export async function registerExtMdx(): Promise<void> {
  const ext = extMdxFactory();
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

await registerExtMdx();
