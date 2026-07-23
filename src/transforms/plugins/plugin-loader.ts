/**
 * Shim that routes MDX plugin lookups through the `ContentProcessor`
 * extension contract (default implementation: `@veryfront/ext-content-mdx`).
 *
 * Build-time MDX compilers (`src/build/compiler/mdx-compiler/mdx-processor.ts`,
 * `src/build/renderer/services/mdx-bundler.ts`, `layout-applicator.ts`)
 * historically imported `getRemarkPlugins` / `getRehypePlugins` directly.
 * Now those callers get the canonical plugin list from whichever
 * `ContentProcessor` implementation is registered.
 *
 * When no implementation is registered, the lookup throws with an
 * actionable install message pointing at `@veryfront/ext-content-mdx`.
 *
 * @module transforms/plugins/plugin-loader
 */

import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentPlugin, ContentProcessor } from "#veryfront/extensions/content/index.ts";

/** Return remark plugins from the registered content processor. */
export function getRemarkPlugins(): ContentPlugin[] {
  const processor = resolveContract<ContentProcessor>("ContentProcessor");
  return processor.getRemarkPlugins();
}

/** Return rehype plugins from the registered content processor. */
export function getRehypePlugins(): ContentPlugin[] {
  const processor = resolveContract<ContentProcessor>("ContentProcessor");
  return processor.getRehypePlugins();
}
