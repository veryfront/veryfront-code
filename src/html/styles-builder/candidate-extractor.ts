/**
 * Provider-neutral CSS candidate extraction from source files.
 *
 * Extracts class name candidates from source code for Tailwind CSS compilation.
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
import { isProxy as isProxyWithoutHooks } from "node:util/types";

const apply = Reflect.apply;
const NativeTypeError = TypeError;
const SetConstructor = Set;
const StringConstructor = String;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const isArray = Array.isArray;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const stringEndsWith = String.prototype.endsWith;
const sourceExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"] as const;

export { extractCandidates } from "./candidate-tokenizer.ts";
export { hashCandidates, hashCSS, hashString } from "./css-identity.ts";

export function extractCandidatesFromFiles(
  files: readonly { path: string; content?: string }[],
  options: {
    projectDir?: string;
    styleProfile?: StyleScopeProfile;
  } = {},
): Set<string> {
  if (isProxyWithoutHooks(files) || !isArray(files) || files.length > MAX_CSS_FILES) {
    throw new NativeTypeError(
      `CSS candidate files must be an array of at most ${MAX_CSS_FILES} files`,
    );
  }
  const candidates = new SetConstructor<string>();
  let candidateCount = 0;
  let sourceBytes = 0;

  for (let index = 0; index < files.length; index++) {
    const fileDescriptor = getOwnPropertyDescriptor(files, StringConstructor(index));
    if (!fileDescriptor || !("value" in fileDescriptor)) {
      throw new NativeTypeError("CSS candidate files must be a dense data-property array");
    }
    const file = fileDescriptor.value;
    if (isProxyWithoutHooks(file) || typeof file !== "object" || file === null) {
      throw new NativeTypeError("CSS candidate file entries must be non-Proxy objects");
    }
    const pathDescriptor = getOwnPropertyDescriptor(file, "path");
    const contentDescriptor = getOwnPropertyDescriptor(file, "content");
    if (
      !pathDescriptor || !("value" in pathDescriptor) || typeof pathDescriptor.value !== "string"
    ) {
      throw new NativeTypeError("CSS candidate file path must be an own string data property");
    }
    if (contentDescriptor && !("value" in contentDescriptor)) {
      throw new NativeTypeError("CSS candidate file content must be a data property");
    }
    const path = pathDescriptor.value;
    const content = contentDescriptor?.value;
    if (content === undefined || content === "") continue;
    if (typeof content !== "string") {
      throw new NativeTypeError("CSS candidate file content must be a string when present");
    }
    if (
      options.styleProfile &&
      !shouldIncludeStylePath(options.styleProfile, path, options.projectDir)
    ) {
      continue;
    }
    let isSourceFile = false;
    for (let extensionIndex = 0; extensionIndex < sourceExtensions.length; extensionIndex++) {
      if (apply(stringEndsWith, path, [sourceExtensions[extensionIndex]])) {
        isSourceFile = true;
        break;
      }
    }
    if (!isSourceFile) continue;

    const extracted = extractCandidatesWithByteLength(content, `CSS candidate source ${path}`);
    if (extracted.sourceBytes > MAX_CSS_TOTAL_BYTES - sourceBytes) {
      throw new NativeTypeError(`CSS candidate sources exceed ${MAX_CSS_TOTAL_BYTES} total bytes`);
    }
    sourceBytes += extracted.sourceBytes;
    for (let candidateIndex = 0; candidateIndex < extracted.candidates.length; candidateIndex++) {
      const candidate = extracted.candidates[candidateIndex];
      if (!apply(setHas, candidates, [candidate]) && candidateCount >= MAX_CSS_SELECTOR_TOKENS) {
        throw new NativeTypeError(
          `CSS candidate extraction cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`,
        );
      }
      if (!apply(setHas, candidates, [candidate])) {
        apply(setAdd, candidates, [candidate]);
        candidateCount++;
      }
    }
  }

  return candidates;
}
