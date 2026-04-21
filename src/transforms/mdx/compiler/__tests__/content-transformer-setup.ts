/**
 * Shared test helper: activates the `@veryfront/ext-mdx` extension so core
 * tests that exercise the MDX / Markdown compile paths can resolve the
 * `ContentTransformer` contract.
 *
 * Import this module (for side effects) from any test that calls
 * `compileMDXRuntime` / `compileMarkdownRuntime` or that hits code paths
 * which go through `plugin-loader.getRemarkPlugins` /
 * `plugin-loader.getRehypePlugins`.
 *
 * @module transforms/mdx/compiler/__tests__/content-transformer-setup
 */

import { register as registerContract } from "#veryfront/extensions/contracts.ts";
import extMdxFactory from "../../../../../extensions/ext-mdx/src/index.ts";

const ext = extMdxFactory();
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
