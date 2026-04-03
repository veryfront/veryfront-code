/**
 * Command suggestion via Levenshtein distance
 *
 * @module cli/shared/suggest
 */

export function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return matrix[a.length]![b.length]!;
}

export function suggestCommand(
  input: string,
  commands: string[],
  maxDistance = 2,
): string[] {
  return commands
    .map((cmd) => ({ cmd, dist: levenshtein(input, cmd) }))
    .filter(({ dist }) => dist <= maxDistance)
    .sort((a, b) => a.dist - b.dist)
    .map(({ cmd }) => cmd);
}
