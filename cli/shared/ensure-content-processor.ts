import { tryResolve } from "veryfront/extensions";
import { register } from "../../src/extensions/contracts.ts";
import type { ContentProcessor } from "veryfront/extensions/content";
import { importFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";

type ContentMdxExtensionModule = {
  MdxContentProcessor: new () => ContentProcessor;
};

let contentMdxModulePromise: Promise<ContentMdxExtensionModule> | undefined;

function loadContentMdxModule(): Promise<ContentMdxExtensionModule> {
  contentMdxModulePromise ??= importFirstPartyExtensionModule<ContentMdxExtensionModule>(
    "ext-content-mdx",
    "@veryfront/ext-content-mdx",
  ).catch((error) => {
    contentMdxModulePromise = undefined;
    throw error;
  });
  return contentMdxModulePromise;
}

/**
 * Start loading ext-mdx before the server accepts requests. Registration must
 * still happen after server start (bootstrap `reset()` clears the contract
 * registry), but with the module already loaded the post-start await in
 * `ensureBuiltinContentProcessor` resolves without an I/O gap, so no request
 * can observe a missing ContentProcessor contract in between.
 */
export function prefetchBuiltinContentProcessor(): void {
  loadContentMdxModule().catch(() => {
    // Errors surface in ensureBuiltinContentProcessor, which awaits the same load.
  });
}

/**
 * The CLI ships ext-mdx baked in so the compiled binary can render MDX/Markdown
 * pages out of the box. Library consumers (programmatic `startProductionServer`)
 * still opt in via `veryfront.config.ts` extensions. Bootstrap's
 * `setupAll` to `teardownAll` to `reset()` clears the contract registry, so this
 * must run *after* the server-start (or `getConfig`) call returns. We skip
 * registration when a user-provided extension already supplied the contract.
 */
export async function ensureBuiltinContentProcessor(): Promise<void> {
  if (tryResolve<ContentProcessor>("ContentProcessor")) return;
  const { MdxContentProcessor } = await loadContentMdxModule();
  register<ContentProcessor>("ContentProcessor", new MdxContentProcessor());
}
