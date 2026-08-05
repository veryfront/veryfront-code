import { hashString } from "#veryfront/cache/hash.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export const DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV =
  "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT";
export const DEPENDENCY_PINNING_PROJECTS_ENV = "VERYFRONT_DEPENDENCY_PINNING_PROJECTS";

export interface DependencyPinningCohortInput {
  readonly rolloutPercent?: string;
  readonly projectAllowlist?: string;
}

export interface DependencyPinningCohortConfig {
  readonly rolloutBasisPoints: number;
  readonly projectAllowlist: readonly string[];
}

const ROLLOUT_BUCKETS = 10_000;
const PERCENT_RE = /^(?:100(?:\.0{1,2})?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/;

function parseRolloutBasisPoints(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized || !PERCENT_RE.test(normalized)) return 0;
  return Math.round(Number(normalized) * 100);
}

function parseProjectAllowlist(value: string | undefined): readonly string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((projectId) => projectId.trim()).filter(Boolean))];
}

function base36ToBigInt(value: string): bigint {
  let result = 0n;
  for (const character of value) {
    result = result * 36n + BigInt(Number.parseInt(character, 36));
  }
  return result;
}

/**
 * Parse cohort settings. An absent or malformed percentage collapses to zero so
 * a typo can never widen the rollout, which is the property that keeps the
 * already-armed production pinning flag inert until it is deliberately ramped.
 */
export function parseDependencyPinningCohortConfig(
  input: DependencyPinningCohortInput,
): DependencyPinningCohortConfig {
  return {
    rolloutBasisPoints: parseRolloutBasisPoints(input.rolloutPercent),
    projectAllowlist: parseProjectAllowlist(input.projectAllowlist),
  };
}

/** Stable 0..9999 bucket. The domain prefix isolates this rollout from others. */
function dependencyPinningProjectBucket(projectId: string): number {
  const hash = hashString(`dependency-pinning-rollout:${projectId}`);
  return Number(base36ToBigInt(hash) % BigInt(ROLLOUT_BUCKETS));
}

/**
 * Decide whether a project is inside the pinning cohort.
 *
 * A full rollout is universal, including for code paths that carry no project
 * identity, so a fully ramped environment never silently loses coverage on a
 * request that lacks a project id. Any partial rollout fails closed on missing
 * identity instead, because an unidentifiable project cannot be assigned a
 * stable bucket and must not flip between cohorts across renders.
 */
export function resolveDependencyPinningCohort(
  projectId: string | null | undefined,
  config: DependencyPinningCohortConfig,
): boolean {
  if (config.rolloutBasisPoints >= ROLLOUT_BUCKETS) return true;
  if (config.rolloutBasisPoints <= 0 && config.projectAllowlist.length === 0) return false;
  if (!projectId) return false;
  if (config.projectAllowlist.includes(projectId)) return true;
  return dependencyPinningProjectBucket(projectId) < config.rolloutBasisPoints;
}

/** Read host-owned cohort configuration. */
export function readDependencyPinningCohortConfig(): DependencyPinningCohortConfig {
  return parseDependencyPinningCohortConfig({
    rolloutPercent: getHostEnv(DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV),
    projectAllowlist: getHostEnv(DEPENDENCY_PINNING_PROJECTS_ENV),
  });
}

/** Small external interface for callers that do not need the parsed config. */
export function isProjectInDependencyPinningCohort(
  projectId: string | null | undefined,
): boolean {
  return resolveDependencyPinningCohort(projectId, readDependencyPinningCohortConfig());
}
