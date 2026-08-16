import { tryResolve } from "veryfront/extensions";
import { register } from "../../src/extensions/contracts.ts";
import type { ContentProcessor } from "veryfront/extensions/content";
import {
  firstPartyExtensionSourceSpecifiers,
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "veryfront/extensions/first-party-import";

type ContentMdxExtensionModule = {
  MdxContentProcessor: new () => ContentProcessor;
};

const CONTENT_MDX_DIRECTORY = "ext-content-mdx";
const CONTENT_MDX_PACKAGE = `@veryfront/${CONTENT_MDX_DIRECTORY}`;

/**
 * Specifiers a "not installed" failure is allowed to name: the npm package and
 * the workspace source entries the loader tries first. Derived rather than
 * written out so they stay in step with the loader, and so this module keeps
 * naming no extension source path of its own.
 *
 * A load failure naming anything else — a broken transitive dependency inside
 * an installed ext-content-mdx, say — is a real error and must not be
 * swallowed.
 */
const CONTENT_MDX_SPECIFIERS = [
  CONTENT_MDX_PACKAGE,
  ...firstPartyExtensionSourceSpecifiers(CONTENT_MDX_DIRECTORY).map((specifier) =>
    specifier.replace(/^(?:\.\.\/)+/, "")
  ),
];

let contentMdxModulePromise: Promise<ContentMdxExtensionModule> | undefined;

function loadContentMdxModule(): Promise<ContentMdxExtensionModule> {
  contentMdxModulePromise ??= importFirstPartyExtensionModule<ContentMdxExtensionModule>(
    CONTENT_MDX_DIRECTORY,
    CONTENT_MDX_PACKAGE,
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
 *
 * The npm distribution declares @veryfront/ext-content-mdx as an *optional
 * peer* (see scripts/build/npm-package-metadata.ts), so a plain
 * `npm install veryfront` does not install it. Every server start calls this,
 * including projects with no .mdx or .md file at all, so a missing package must
 * not be fatal here. Leaving the contract unregistered defers the report to the
 * compile path, which throws the typed MISSING_EXTENSION_ERROR naming
 * @veryfront/ext-content-mdx only when content is actually rendered.
 *
 * `load` is a test seam and defaults to the real module loader.
 */
export async function ensureBuiltinContentProcessor(
  load: () => Promise<ContentMdxExtensionModule> = loadContentMdxModule,
): Promise<void> {
  if (tryResolve<ContentProcessor>("ContentProcessor")) return;

  let module: ContentMdxExtensionModule;
  try {
    module = await load();
  } catch (error) {
    if (isMissingFirstPartyExtensionModule(error, CONTENT_MDX_SPECIFIERS)) return;
    throw error;
  }

  register<ContentProcessor>("ContentProcessor", new module.MdxContentProcessor());
}
