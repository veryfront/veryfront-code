import { tryResolve } from "veryfront/extensions";
import { register } from "../../src/extensions/contracts.ts";
import type { ContentTransformer } from "veryfront/extensions/content";
import { MdxContentTransformer } from "../../extensions/ext-content-mdx/src/index.ts";

/**
 * The CLI ships ext-mdx baked in so the compiled binary can render MDX/Markdown
 * pages out of the box. Library consumers (programmatic `startProductionServer`)
 * still opt in via `veryfront.config.ts` extensions. Bootstrap's
 * `setupAll → teardownAll → reset()` clears the contract registry, so this
 * must run *after* the server-start (or `getConfig`) call returns. We skip
 * registration when a user-provided extension already supplied the contract.
 */
export function ensureBuiltinContentTransformer(): void {
  if (tryResolve<ContentTransformer>("ContentTransformer")) return;
  register<ContentTransformer>("ContentTransformer", new MdxContentTransformer());
}
