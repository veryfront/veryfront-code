/**
 * CSS processor candidate extraction from source files.
 *
 * Extracts class-name candidates from source code for provider-owned CSS compilation.
 *
 * @module html/styles-builder/candidate-extractor
 */

import type { StyleScopeProfile } from "./style-scope-profile.ts";
import { shouldIncludeStylePath } from "./style-scope-profile.ts";
import { extractCandidates } from "./candidate-tokenizer.ts";

export { extractCandidates } from "./candidate-tokenizer.ts";
export { hashCandidates, hashCSS, hashString } from "./css-identity.ts";

export function extractCandidatesFromFiles(
  files: Array<{ path: string; content?: string }>,
  options: {
    projectDir?: string;
    styleProfile?: StyleScopeProfile;
  } = {},
): Set<string> {
  const candidates = new Set<string>();
  const sourceExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];

  for (const file of files) {
    if (!file.content) continue;
    if (
      options.styleProfile &&
      !shouldIncludeStylePath(options.styleProfile, file.path, options.projectDir)
    ) {
      continue;
    }
    if (!sourceExtensions.some((ext) => file.path.endsWith(ext))) continue;

    for (const candidate of extractCandidates(file.content)) {
      candidates.add(candidate);
    }
  }

  return candidates;
}
