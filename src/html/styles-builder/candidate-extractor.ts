/**
 * CSS processor candidate extraction from source files.
 *
 * Extracts class-name candidates from source code for provider-owned CSS compilation.
 *
 * @module html/styles-builder/candidate-extractor
 */

import type { StyleScopeProfile } from "./style-scope-profile.ts";
import { extractCandidatesWithByteLength } from "./candidate-tokenizer.ts";
import { MAX_CSS_SELECTOR_TOKENS, MAX_CSS_TOTAL_BYTES } from "#veryfront/utils/constants/css.ts";
import { snapshotSuppliedProjectStyleSourceFiles } from "./project-style-source-snapshot.ts";

export { extractCandidates } from "./candidate-tokenizer.ts";
export { hashCandidates, hashCSS, hashString } from "./css-identity.ts";

export function extractCandidatesFromFiles(
  files: readonly { path: string; content?: string }[],
  options: {
    projectDir?: string;
    styleProfile?: StyleScopeProfile;
  } = {},
): Set<string> {
  const sourceFiles = snapshotSuppliedProjectStyleSourceFiles(files, {
    projectDir: options.projectDir,
    styleProfile: options.styleProfile,
  });
  const candidates = new Set<string>();
  const sourceExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];
  let sourceBytes = 0;

  for (const file of sourceFiles) {
    const path = file.path;
    if (!file.content) continue;
    if (!sourceExtensions.some((ext) => path.endsWith(ext))) continue;

    const extracted = extractCandidatesWithByteLength(
      file.content,
      `CSS candidate source ${path}`,
    );
    if (extracted.sourceBytes > MAX_CSS_TOTAL_BYTES - sourceBytes) {
      throw new TypeError(`CSS candidate sources exceed ${MAX_CSS_TOTAL_BYTES} total bytes`);
    }
    sourceBytes += extracted.sourceBytes;

    for (const candidate of extracted.candidates) {
      if (!candidates.has(candidate) && candidates.size >= MAX_CSS_SELECTOR_TOKENS) {
        throw new TypeError(
          `CSS candidate extraction cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`,
        );
      }
      candidates.add(candidate);
    }
  }

  return candidates;
}
