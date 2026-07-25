/**
 * Compute cosine similarity without overflowing or underflowing finite vector
 * magnitudes.
 *
 * Empty, dimension-mismatched, and zero vectors retain the existing `0`
 * compatibility result. Invalid non-finite coordinates retain a non-finite
 * result until the public validation contract is resolved.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let scaleA = 0;
  let scaleB = 0;
  for (let index = 0; index < a.length; index++) {
    scaleA = Math.max(scaleA, Math.abs(a[index]!));
    scaleB = Math.max(scaleB, Math.abs(b[index]!));
  }
  if (scaleA === 0 || scaleB === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    const normalizedA = a[index]! / scaleA;
    const normalizedB = b[index]! / scaleB;
    dot += normalizedA * normalizedB;
    normA += normalizedA * normalizedA;
    normB += normalizedB * normalizedB;
  }

  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(similarity) ? Math.max(-1, Math.min(1, similarity)) : similarity;
}
