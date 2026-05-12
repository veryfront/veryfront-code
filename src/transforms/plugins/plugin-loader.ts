/**
 * Shim that routes MDX plugin lookups through the `ContentTransformer`
 * extension contract (default implementation: `@veryfront/ext-transform-mdx`).
 *
 * Build-time MDX compilers (`src/build/compiler/mdx-compiler/mdx-processor.ts`,
 * `src/build/renderer/services/mdx-bundler.ts`, `layout-applicator.ts`)
 * historically imported `getRemarkPlugins` / `getRehypePlugins` directly.
 * Now those callers get the canonical plugin list from whichever
 * `ContentTransformer` implementation is registered.
 *
 * When no implementation is registered, the lookup throws with an
 * actionable install message pointing at `@veryfront/ext-transform-mdx`.
 *
 * @module transforms/plugins/plugin-loader
 */

import type { Pluggable } from "unified";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentTransformer } from "#veryfront/extensions/transform/index.ts";

export function getRemarkPlugins(): Pluggable[] {
  const transformer = resolveContract<ContentTransformer>("ContentTransformer");
  return transformer.getRemarkPlugins() as unknown as Pluggable[];
}

export function getRehypePlugins(): Pluggable[] {
  const transformer = resolveContract<ContentTransformer>("ContentTransformer");
  return transformer.getRehypePlugins() as unknown as Pluggable[];
}
