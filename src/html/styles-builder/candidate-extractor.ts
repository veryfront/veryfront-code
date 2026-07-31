/**
 * CSS processor candidate extraction from source files.
 *
 * Extracts class-name candidates from source code for provider-owned CSS compilation.
 *
 * @module html/styles-builder/candidate-extractor
 */

import type { StyleScopeProfile } from "./style-scope-profile.ts";
import { shouldIncludeStylePath } from "./style-scope-profile.ts";
import { extractCandidatesWithByteLength } from "./candidate-tokenizer.ts";
import {
  MAX_CSS_FILES,
  MAX_CSS_SELECTOR_TOKENS,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";
import { assertBoundedPathString } from "#veryfront/utils/project-relative-path.ts";

export { extractCandidates } from "./candidate-tokenizer.ts";
export { hashCandidates, hashCSS, hashString } from "./css-identity.ts";

export function extractCandidatesFromFiles(
  files: Array<{ path: string; content?: string }>,
  options: {
    projectDir?: string;
    styleProfile?: StyleScopeProfile;
  } = {},
): Set<string> {
  if (!Array.isArray(files) || files.length > MAX_CSS_FILES) {
    throw new TypeError(`CSS candidate extraction cannot exceed ${MAX_CSS_FILES} source files`);
  }
  const candidates = new Set<string>();
  const sourceExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];
  let sourceBytes = 0;

  for (const file of files) {
    const path = assertBoundedPathString(file.path, "CSS candidate source path");
    if (!file.content) continue;
    if (
      options.styleProfile &&
      !shouldIncludeStylePath(options.styleProfile, path, options.projectDir)
    ) {
      continue;
    }
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
