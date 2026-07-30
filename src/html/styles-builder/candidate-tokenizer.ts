/**
 * Dependency-free CSS candidate tokenization.
 *
 * Kept separate from project style-scope filtering so build tooling can reuse
 * the tokenizer without importing application configuration.
 *
 * @module html/styles-builder/candidate-tokenizer
 */

/** Extract potential class-name candidates from source content. */
export function extractCandidates(content: string): string[] {
  const pattern = /!?-?@?(?:[a-zA-Z0-9]|\[&?)[a-zA-Z0-9_\-:\/\.\[\]%#,()!'=<>$@{}|*+?;^~]*/g;
  return [...new Set(content.match(pattern) ?? [])];
}
