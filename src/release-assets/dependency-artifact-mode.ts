import { hashString } from "#veryfront/cache/hash.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export const DEPENDENCY_ARTIFACT_MODE_ENV = "VERYFRONT_DEPENDENCY_ARTIFACT_MODE";
export const DEPENDENCY_ARTIFACT_ROLLOUT_PERCENT_ENV =
  "VERYFRONT_DEPENDENCY_ARTIFACT_ROLLOUT_PERCENT";
export const DEPENDENCY_ARTIFACT_PROJECTS_ENV = "VERYFRONT_DEPENDENCY_ARTIFACT_PROJECTS";

export type DependencyArtifactMode = "off" | "shadow" | "prefer" | "require";

export interface DependencyArtifactRolloutInput {
  readonly mode?: string;
  readonly rolloutPercent?: string;
  readonly projectAllowlist?: string;
}

export interface DependencyArtifactRolloutConfig {
  readonly mode: DependencyArtifactMode;
  readonly rolloutBasisPoints: number;
  readonly projectAllowlist: readonly string[];
}

const VALID_MODES = new Set<DependencyArtifactMode>([
  "off",
  "shadow",
  "prefer",
  "require",
]);
const ROLLOUT_BUCKETS = 10_000;
const PERCENT_RE = /^(?:100(?:\.0{1,2})?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/;

function parseMode(value: string | undefined): DependencyArtifactMode {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_MODES.has(normalized as DependencyArtifactMode)
    ? normalized as DependencyArtifactMode
    : "off";
}

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
 * Parse rollout settings without activating behavior. Invalid or absent modes
 * collapse to an empty, off configuration so later callers cannot accidentally
 * select a cohort from stale percentage or allowlist values.
 */
export function parseDependencyArtifactRolloutConfig(
  input: DependencyArtifactRolloutInput,
): DependencyArtifactRolloutConfig {
  const mode = parseMode(input.mode);
  if (mode === "off") {
    return { mode, rolloutBasisPoints: 0, projectAllowlist: [] };
  }

  return {
    mode,
    rolloutBasisPoints: parseRolloutBasisPoints(input.rolloutPercent),
    projectAllowlist: parseProjectAllowlist(input.projectAllowlist),
  };
}

/** Stable 0..9999 cohort bucket. The domain prefix isolates this rollout. */
function dependencyArtifactProjectBucket(projectId: string): number {
  const hash = hashString(`dependency-artifact-rollout:${projectId}`);
  return Number(base36ToBigInt(hash) % BigInt(ROLLOUT_BUCKETS));
}

/**
 * Resolve the effective mode for a project. Explicit project selection and the
 * deterministic percentage cohort form a union. Missing project identity fails
 * closed so global or framework-only requests cannot enter a rollout.
 */
export function resolveDependencyArtifactMode(
  projectId: string | null | undefined,
  config: DependencyArtifactRolloutConfig,
): DependencyArtifactMode {
  if (config.mode === "off" || !projectId) return "off";
  if (config.projectAllowlist.includes(projectId)) return config.mode;
  return dependencyArtifactProjectBucket(projectId) < config.rolloutBasisPoints
    ? config.mode
    : "off";
}

/** Read host-owned rollout configuration once at the future request setup seam. */
export function readDependencyArtifactRolloutConfig(): DependencyArtifactRolloutConfig {
  return parseDependencyArtifactRolloutConfig({
    mode: getHostEnv(DEPENDENCY_ARTIFACT_MODE_ENV),
    rolloutPercent: getHostEnv(DEPENDENCY_ARTIFACT_ROLLOUT_PERCENT_ENV),
    projectAllowlist: getHostEnv(DEPENDENCY_ARTIFACT_PROJECTS_ENV),
  });
}

/** Small external interface for callers that do not need the parsed config. */
export function getDependencyArtifactModeForProject(
  projectId: string | null | undefined,
): DependencyArtifactMode {
  return resolveDependencyArtifactMode(projectId, readDependencyArtifactRolloutConfig());
}
