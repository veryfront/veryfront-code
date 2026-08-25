import {
  type DependencyPinningSourceInput,
  getProjectDependenciesSync,
  isCurrentDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import {
  isDependencyPinningEnabled,
  isExactSemver,
  schedulePlatformDependencyResolution,
  scheduleUndeclaredDependencyResolution,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { isProjectInDependencyPinningCohort } from "#veryfront/transforms/esm/dependency-pinning-cohort.ts";

export interface DependencyResolutionObservation {
  readonly packageName: string;
  /** Exact caller-observed package declaration, or null when absent. */
  readonly declaration: string | null;
}

/**
 * Validate cached observations against the exact immutable dependency map.
 * This rejects malformed, duplicate, or cross-snapshot metadata before replay.
 */
export function validateDependencyResolutionObservations(
  value: unknown,
  dependencies?: Readonly<Record<string, string>>,
): readonly DependencyResolutionObservation[] | null {
  if (!Array.isArray(value)) return null;

  const observations: DependencyResolutionObservation[] = [];
  const seenPackages = new Set<string>();
  for (const candidate of value) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      typeof candidate.packageName !== "string" ||
      candidate.packageName.length === 0 ||
      (candidate.declaration !== null &&
        typeof candidate.declaration !== "string") ||
      seenPackages.has(candidate.packageName)
    ) {
      return null;
    }

    if (dependencies === undefined) {
      if (value.length > 0) return null;
    } else {
      const currentDeclaration = Object.hasOwn(dependencies, candidate.packageName)
        ? dependencies[candidate.packageName]
        : null;
      if (currentDeclaration !== candidate.declaration) return null;
    }

    seenPackages.add(candidate.packageName);
    observations.push({
      packageName: candidate.packageName,
      declaration: candidate.declaration,
    });
  }

  return observations;
}

export interface ImportDependencyResolutionContext {
  projectDir?: string | null;
  projectId?: string | null;
  dependencyPinningSource?: DependencyPinningSourceInput;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /**
   * Records unresolved imports as inert cache metadata. Replays still pass
   * through this resolver so current snapshot authority and scheduler TTLs
   * remain the only gates for platform persistence.
   */
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void;
  /** Record unresolved metadata without scheduling a platform write. */
  dependencyResolutionObservationOnly?: boolean;
}

/**
 * Decide whether pinning applies to this rewrite.
 *
 * A cache key means the snapshot already decided, and that decision is
 * authoritative: re-deciding here would let a mid-render configuration change
 * split a single render across two policies. Only the keyless fallback path
 * consults the rollout cohort. "on:unknown" means the dependency state could
 * not be established (unreadable package.json), so it falls back to
 * conservative flag-off behavior.
 */
export function isPinningEnabledForRewrite(
  ctx: ImportDependencyResolutionContext,
): boolean {
  if (ctx.dependencyPinningCacheKey === "on:unknown") return false;
  if (ctx.dependencyPinningCacheKey) {
    return ctx.dependencyPinningCacheKey.startsWith("on:");
  }
  return isDependencyPinningEnabled() && isProjectInDependencyPinningCohort(ctx.projectId);
}

/**
 * Return an exact dependency pin when one is present. Non-exact declarations
 * and known undeclared imports are handed to the bounded platform scheduler.
 *
 * An enabled snapshot without a dependency map is intentionally treated as
 * unknown: it must not be mistaken for an empty, verified package.json.
 */
export function resolveDependencyPinForImport(
  packageName: string,
  ctx: ImportDependencyResolutionContext,
): string | undefined {
  if (!isPinningEnabledForRewrite(ctx)) return undefined;

  const dependencySource = ctx.dependencyPinningSource ?? ctx.projectDir;
  const dependencies = ctx.dependencyPinningDependencies ??
    (dependencySource
      ? getProjectDependenciesSync(
        dependencySource,
        ctx.dependencyPinningCacheKey,
      )
      : undefined);
  if (dependencies === undefined) return undefined;

  const declaration = Object.hasOwn(dependencies, packageName)
    ? dependencies[packageName]
    : undefined;
  if (declaration !== undefined && isExactSemver(declaration)) {
    return declaration;
  }

  ctx.onDependencyResolutionObserved?.({
    packageName,
    declaration: declaration ?? null,
  });
  if (ctx.dependencyResolutionObservationOnly) return undefined;

  const cacheKey = ctx.dependencyPinningCacheKey;
  const writebackSource = ctx.dependencyPinningSource;
  const writebackTarget = typeof writebackSource === "object" &&
      writebackSource !== null
    ? writebackSource.dependencyWritebackTarget
    : undefined;
  const writebackToken = typeof writebackSource === "object" &&
      writebackSource !== null
    ? writebackSource.dependencyWritebackToken
    : undefined;
  const writebackAuthorization = writebackSource &&
      writebackTarget &&
      cacheKey?.startsWith("on:") &&
      cacheKey !== "on:unknown"
    ? {
      target: writebackTarget,
      authToken: writebackToken,
      isEligible: () => isCurrentDependencyPinningSnapshot(writebackSource, cacheKey),
    }
    : undefined;

  if (declaration !== undefined) {
    if (ctx.projectId && writebackAuthorization) {
      schedulePlatformDependencyResolution(
        ctx.projectId,
        packageName,
        declaration,
        writebackAuthorization,
      );
    }
  } else if (ctx.projectId && writebackAuthorization) {
    scheduleUndeclaredDependencyResolution(
      ctx.projectId,
      packageName,
      writebackAuthorization,
    );
  }

  return undefined;
}
