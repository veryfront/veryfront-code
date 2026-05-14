/**
 * Shim that routes MDX plugin lookups through the `ContentProcessor`
 * extension contract (default implementation: `@veryfront/ext-transform-mdx`).
 *
 * Build-time MDX compilers (`src/build/compiler/mdx-compiler/mdx-processor.ts`,
 * `src/build/renderer/services/mdx-bundler.ts`, `layout-applicator.ts`)
 * historically imported `getRemarkPlugins` / `getRehypePlugins` directly.
 * Now those callers get the canonical plugin list from whichever
 * `ContentProcessor` implementation is registered.
 *
 * When no implementation is registered, the lookup throws with an
 * actionable install message pointing at `@veryfront/ext-transform-mdx`.
 *
 * @module transforms/plugins/plugin-loader
 */

import type { Pluggable } from "unified";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/transform/index.ts";

export function getRemarkPlugins(): Pluggable[] {
  const processor = resolveContract<ContentProcessor>("ContentProcessor");
  return processor.getRemarkPlugins() as unknown as Pluggable[];
}

export function getRehypePlugins(): Pluggable[] {
  const processor = resolveContract<ContentProcessor>("ContentProcessor");
  return processor.getRehypePlugins() as unknown as Pluggable[];
}
