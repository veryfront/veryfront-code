const generations = new Map<string, number>();
let globalGeneration = 0;
const dateNow = Date.now;

function freshGenerationAfter(generation: number): number {
  return Math.max(generation + 1, dateNow() * 1_000);
}

/** Current in-process invalidation generation for one manifest namespace. */
export function getCycleManifestGeneration(manifestDir: string): number {
  const existing = generations.get(manifestDir);
  if (existing !== undefined) return existing;
  generations.set(manifestDir, globalGeneration);
  return globalGeneration;
}

/** Adopt persisted state once, then reject artifacts invalidated in this process. */
export function isCurrentCycleManifestGeneration(
  manifestDir: string,
  artifactGeneration: number,
): boolean {
  const existing = generations.get(manifestDir);
  if (existing !== undefined) return artifactGeneration === existing;

  const currentGeneration = Math.max(globalGeneration, artifactGeneration);
  generations.set(manifestDir, currentGeneration);
  return artifactGeneration === currentGeneration;
}

/** Advance synchronously so transforms started after invalidation get a new generation. */
export function advanceCycleManifestGeneration(manifestDir: string): number {
  const existing = generations.get(manifestDir);
  const generation = existing === undefined ? freshGenerationAfter(globalGeneration) : existing + 1;
  generations.set(manifestDir, generation);
  return generation;
}

/** Invalidate every manifest transaction created before a full cache clear. */
export function advanceAllCycleManifestGenerations(): number {
  for (const generation of generations.values()) {
    if (generation > globalGeneration) globalGeneration = generation;
  }
  globalGeneration = freshGenerationAfter(globalGeneration);
  for (const manifestDir of generations.keys()) generations.set(manifestDir, globalGeneration);
  return globalGeneration;
}

/** Extract the generation prefix from a graph directory name. */
export function parseCycleManifestGeneration(name: string): number | undefined {
  const separator = name.indexOf("-");
  if (separator <= 0) return undefined;
  const prefix = name.slice(0, separator);
  if (!/^(?:0|[1-9][0-9]*)$/.test(prefix)) return undefined;
  const generation = Number(prefix);
  return Number.isSafeInteger(generation) ? generation : undefined;
}
