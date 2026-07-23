/** Extract bounded Tailwind candidates from project-contained source files. */

import { extractCandidatesFromFiles } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import {
  MAX_CSS_CANDIDATE_BYTES,
  MAX_CSS_CANDIDATES,
  MAX_TOTAL_CSS_CANDIDATE_BYTES,
  utf8ByteLength,
} from "#veryfront/html/styles-builder/resource-limits.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import type { HandlerContext } from "../types.ts";
import { FRAMEWORK_CANDIDATES } from "./framework-candidates.generated.ts";
import { type CollectedStyleSourceFile, collectStyleSourceFiles } from "./styles-source-scanner.ts";

const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"] as const;

function addBoundedCandidate(
  candidates: Set<string>,
  candidate: string,
  currentBytes: number,
): number {
  if (candidates.has(candidate)) return currentBytes;
  if (candidates.size >= MAX_CSS_CANDIDATES) {
    throw new TypeError("CSS candidate count exceeds the limit");
  }
  if (candidate.length > MAX_CSS_CANDIDATE_BYTES) {
    throw new TypeError("CSS candidate exceeds the size limit");
  }
  const candidateBytes = utf8ByteLength(candidate);
  if (candidateBytes > MAX_CSS_CANDIDATE_BYTES) {
    throw new TypeError("CSS candidate exceeds the size limit");
  }
  const nextBytes = currentBytes + candidateBytes;
  if (nextBytes > MAX_TOTAL_CSS_CANDIDATE_BYTES) {
    throw new TypeError("CSS candidates exceed the total size limit");
  }
  candidates.add(candidate);
  return nextBytes;
}

/** Extract Tailwind candidates from one immutable request source snapshot. */
export function extractProjectCandidatesFromFiles(
  ctx: HandlerContext,
  files: CollectedStyleSourceFile[],
): Set<string> {
  const projectCandidates = extractCandidatesFromFiles(files, {
    projectDir: ctx.projectDir,
    styleProfile: createStyleScopeProfile(ctx.config),
  });

  const candidates = new Set<string>();
  let candidateBytes = 0;
  for (const candidate of FRAMEWORK_CANDIDATES) {
    candidateBytes = addBoundedCandidate(candidates, candidate, candidateBytes);
  }
  for (const candidate of [...projectCandidates].sort()) {
    candidateBytes = addBoundedCandidate(candidates, candidate, candidateBytes);
  }
  return candidates;
}

/** Extract Tailwind candidates without retaining an additional handler-level cache. */
export async function extractProjectCandidates(ctx: HandlerContext): Promise<Set<string>> {
  const files = await collectStyleSourceFiles(ctx, { extensions: SOURCE_EXTENSIONS });
  return extractProjectCandidatesFromFiles(ctx, files);
}
