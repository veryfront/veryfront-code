/**
 * Compatibility entry points implemented through optional extension contracts.
 *
 * @module platform/compat
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type {
  DocumentExtractor,
  KreuzbergExtractor,
} from "#veryfront/extensions/compat/native-services.ts";

/**
 * Lazily import kreuzberg document extraction.
 *
 * Delegates to the `DocumentExtractor` extension contract
 * (`@veryfront/ext-document-kreuzberg`)
 * when available. Without the extension, throws an actionable error instructing
 * the user to install `ext-document-kreuzberg`.
 *
 * Node/Bun path: `@kreuzberg/node` resolved from the project's node_modules at
 * runtime. The extension handles that dynamic import internally.
 */
export async function importKreuzberg(): Promise<KreuzbergExtractor> {
  const extractor = tryResolve<DocumentExtractor>("DocumentExtractor");
  if (extractor?.importKreuzberg) {
    return extractor.importKreuzberg();
  }
  throw new Error(
    "Document extraction requires a DocumentExtractor extension. " +
      "Install @veryfront/ext-document-kreuzberg and add it to your extensions configuration.",
  );
}
