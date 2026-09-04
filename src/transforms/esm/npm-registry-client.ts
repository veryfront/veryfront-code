/**
 * Platform dependency-resolution scheduler.
 *
 * Transform paths enqueue raw package declarations without blocking rendering.
 * The platform owns semver selection and package.json persistence.
 *
 * @module transforms/esm/npm-registry-client
 */

import { rendererLogger } from "#veryfront/utils";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { resolveHostOwnedApiBaseUrl } from "#veryfront/config/host-api-base.ts";
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import type { DependencyWritebackTarget } from "./package-registry.ts";

const logger = rendererLogger.component("npm-registry-client");
// Captured before project code runs. The write-back may authenticate with the
// host-private stored login token, and the destination it is sent to is derived
// from host-scoped strings here. A project that replaces
// `String.prototype.replace` must not be able to rewrite that destination and
// receive the developer's credential, nor flip a blank/non-blank
// classification through a replaced `String.prototype.trim`.
const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;

function isBlank(value: string | undefined): boolean {
  return value === undefined || (applyIntrinsic(stringTrim, value, []) as string) === "";
}
const SEMVER_NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const SEMVER_PRERELEASE_IDENTIFIER =
  `(?:${SEMVER_NUMERIC_IDENTIFIER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_PRERELEASE = `${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*`;
const SEMVER_BUILD_IDENTIFIER = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
const EXACT_SEMVER_RE = new RegExp(
  `^v?${SEMVER_NUMERIC_IDENTIFIER}\\.${SEMVER_NUMERIC_IDENTIFIER}\\.${SEMVER_NUMERIC_IDENTIFIER}(?:-${SEMVER_PRERELEASE})?(?:\\+${SEMVER_BUILD_IDENTIFIER})?$`,
);
/**
 * Best-effort platform resolver attempts, keyed by project/package/declaration.
 * A short retry window deduplicates repeated transforms while still allowing a
 * transient API failure to recover without blocking rendering.
 */
const platformResolutionAttempts = new Map<string, number>();
const pendingPlatformResolutionAttempts = new Set<string>();
const pendingPlatformResolutionPromises = new Set<Promise<void>>();
export type DependencyResolutionEligibility = () => boolean;
export interface DependencyResolutionScheduleOptions {
  target: DependencyWritebackTarget;
  authToken?: string;
  isEligible?: DependencyResolutionEligibility;
}
interface QueuedPlatformResolution {
  packageName: string;
  rawSpecifier: string;
  expectedDeclaration: string | null;
  attemptKey: string;
  isEligible: DependencyResolutionEligibility;
}
interface QueuedPlatformResolutionBatch {
  projectId: string;
  target: DependencyWritebackTarget;
  authToken?: string;
  resolutions: Map<string, QueuedPlatformResolution>;
}
const queuedPlatformResolutions = new Map<string, QueuedPlatformResolutionBatch>();
const activePlatformFlushes = new Map<string, Promise<void>>();
const PLATFORM_RESOLUTION_RETRY_TTL_MS = 60_000;
const PLATFORM_RESOLUTION_MAX_ATTEMPTS = 4_096;
export const PLATFORM_RESOLUTION_MAX_PENDING = PLATFORM_RESOLUTION_MAX_ATTEMPTS;
const PLATFORM_RESOLUTION_BATCH_SIZE = 100;
export const PLATFORM_RESOLUTION_MAX_CONCURRENCY = 4;
type DependencyResolutionPoster = (
  projectId: string,
  specifiers: string[],
  target: DependencyWritebackTarget,
  expectedDeclarations: Readonly<Record<string, string | null>>,
  authToken?: string,
) => Promise<void>;
let postDependencyResolutionImpl: DependencyResolutionPoster = postDependencyResolution;
const ALWAYS_ELIGIBLE: DependencyResolutionEligibility = () => true;

function isResolutionEligible(
  predicate: DependencyResolutionEligibility,
): boolean {
  try {
    return predicate();
  } catch {
    // Authority checks are fail-closed: transform output remains usable, but a
    // broken predicate must never authorize persistent project mutation.
    return false;
  }
}

class AsyncConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the occupied permit directly to the queued waiter. Keeping
      // `active` unchanged prevents a newly arriving caller from barging in.
      next();
      return;
    }
    this.active--;
  }
}

const platformResolutionLimiter = new AsyncConcurrencyLimiter(
  PLATFORM_RESOLUTION_MAX_CONCURRENCY,
);

/**
 * Overridable clock for tests. Wraps Date.now so FakeTime can intercept it.
 * Replace with a synthetic function via _setClockForTest; restore in afterEach.
 */
let _nowFn: () => number = () => Date.now();

/** Override the clock used by retry deduplication. For tests only. */
export function _setClockForTest(fn: () => number): void {
  _nowFn = fn;
}

function platformResolutionKey(
  projectId: string,
  target: DependencyWritebackTarget,
  packageName: string,
  rangeHint: string | undefined,
): string {
  return `${platformResolutionQueueKey(projectId, target)}\0${packageName}\0${rangeHint ?? ""}`;
}

function dependencyWritebackTargetKey(
  target: DependencyWritebackTarget,
): string {
  return target.kind === "main" ? "main" : `branch:${JSON.stringify(target.branch)}`;
}

function isCanonicalDependencyWritebackTarget(
  target: DependencyWritebackTarget,
): boolean {
  if (target.kind === "main") return true;
  return typeof target.branch === "string" &&
    target.branch.length > 0 &&
    target.branch === target.branch.trim();
}

function platformResolutionQueueKey(
  projectId: string,
  target: DependencyWritebackTarget,
): string {
  return `${projectId}\0${dependencyWritebackTargetKey(target)}`;
}

function pruneExpiredPlatformResolutionAttempts(now: number): void {
  for (const [key, attemptedAt] of platformResolutionAttempts) {
    if (
      now - attemptedAt >= PLATFORM_RESOLUTION_RETRY_TTL_MS &&
      !pendingPlatformResolutionAttempts.has(key)
    ) {
      platformResolutionAttempts.delete(key);
    }
  }
}

/** True when the string is a bare three-part semver version (no range prefix). */
export function isExactSemver(s: string): boolean {
  return EXACT_SEMVER_RE.test(s);
}

/**
 * True when the VERYFRONT_DEPENDENCY_PINNING env flag is set to "1".
 */
export function isDependencyPinningEnabled(): boolean {
  return getHostEnv(DEPENDENCY_PINNING_ENV_FLAG) === "1";
}

/**
 * Schedule a non-blocking platform resolution. Declared ranges/tags are sent
 * verbatim as `package@declaration`; undeclared dependencies are sent as the
 * raw bare package name so the platform can resolve and persist latest.
 */
export function schedulePlatformDependencyResolution(
  projectId: string,
  packageName: string,
  rangeHint?: string,
  options?: DependencyResolutionScheduleOptions,
): void {
  if (!projectId || !packageName || !options) return;
  const isEligible = options.isEligible ?? ALWAYS_ELIGIBLE;
  if (!isResolutionEligible(isEligible)) return;
  if (!isCanonicalDependencyWritebackTarget(options.target)) return;

  const target: DependencyWritebackTarget = Object.freeze({
    ...options.target,
  });
  const key = platformResolutionKey(
    projectId,
    target,
    packageName,
    rangeHint,
  );
  const now = _nowFn();
  const lastAttempt = platformResolutionAttempts.get(key);
  if (
    lastAttempt !== undefined &&
    now - lastAttempt < PLATFORM_RESOLUTION_RETRY_TTL_MS
  ) return;

  const rawSpecifier = rangeHint === undefined ? packageName : `${packageName}@${rangeHint}`;
  const queueKey = platformResolutionQueueKey(projectId, target);
  let queuedBatch = queuedPlatformResolutions.get(queueKey);
  const replaced = queuedBatch?.resolutions.get(packageName);

  // An expired dedupe entry may still be queued behind the global concurrency
  // limiter. It remains active work and must not be admitted a second time.
  if (pendingPlatformResolutionAttempts.has(key)) return;

  if (platformResolutionAttempts.size >= PLATFORM_RESOLUTION_MAX_ATTEMPTS) {
    pruneExpiredPlatformResolutionAttempts(now);
  }
  const replacesPendingAttempt = replaced !== undefined &&
    replaced.attemptKey !== key;
  if (
    !replacesPendingAttempt &&
    pendingPlatformResolutionAttempts.size >= PLATFORM_RESOLUTION_MAX_PENDING
  ) return;
  if (
    !platformResolutionAttempts.has(key) &&
    platformResolutionAttempts.size >= PLATFORM_RESOLUTION_MAX_ATTEMPTS &&
    !replacesPendingAttempt
  ) return;

  if (replacesPendingAttempt) {
    // The replaced declaration never reached the platform, so it must not
    // consume either a backlog slot or the retry window.
    pendingPlatformResolutionAttempts.delete(replaced.attemptKey);
    platformResolutionAttempts.delete(replaced.attemptKey);
  }
  platformResolutionAttempts.set(key, now);
  pendingPlatformResolutionAttempts.add(key);

  if (!queuedBatch) {
    queuedBatch = {
      projectId,
      target,
      authToken: options.authToken,
      resolutions: new Map(),
    };
    queuedPlatformResolutions.set(queueKey, queuedBatch);
  } else if (options.authToken) {
    queuedBatch.authToken = options.authToken;
  }
  queuedBatch.resolutions.set(packageName, {
    packageName,
    rawSpecifier,
    expectedDeclaration: rangeHint ?? null,
    attemptKey: key,
    isEligible,
  });
  schedulePlatformResolutionFlush(queueKey);
}

/**
 * Queue a bare undeclared dependency for platform-owned latest resolution.
 * No local registry lookup is involved, so transform output cannot depend on
 * mutable process-local npm state.
 */
export function scheduleUndeclaredDependencyResolution(
  projectId: string,
  packageName: string,
  options?: DependencyResolutionScheduleOptions,
): void {
  schedulePlatformDependencyResolution(
    projectId,
    packageName,
    undefined,
    options,
  );
}

function schedulePlatformResolutionFlush(queueKey: string): void {
  if (activePlatformFlushes.has(queueKey)) return;

  // Deliberately yield one microtask so all bare imports discovered in the same
  // transform fanout are coalesced into bounded platform requests.
  const flush = Promise.resolve()
    .then(async () => {
      const queued = queuedPlatformResolutions.get(queueKey);
      if (!queued || queued.resolutions.size === 0) return;
      queuedPlatformResolutions.delete(queueKey);

      const resolutions = [...queued.resolutions.values()];
      for (
        let offset = 0;
        offset < resolutions.length;
        offset += PLATFORM_RESOLUTION_BATCH_SIZE
      ) {
        const batch = resolutions.slice(
          offset,
          offset + PLATFORM_RESOLUTION_BATCH_SIZE,
        );
        try {
          await platformResolutionLimiter.run(
            () => {
              // Re-check after coalescing and after waiting for a concurrency
              // permit. The snapshot may have become historical meanwhile.
              const eligibleResolutions: QueuedPlatformResolution[] = [];
              for (const resolution of batch) {
                if (isResolutionEligible(resolution.isEligible)) {
                  eligibleResolutions.push(resolution);
                } else {
                  platformResolutionAttempts.delete(resolution.attemptKey);
                }
              }
              if (eligibleResolutions.length === 0) return Promise.resolve();
              return postDependencyResolutionImpl(
                queued.projectId,
                eligibleResolutions.map((resolution) => resolution.rawSpecifier),
                queued.target,
                Object.fromEntries(
                  eligibleResolutions.map((resolution) => [
                    resolution.packageName,
                    resolution.expectedDeclaration,
                  ]),
                ),
                queued.authToken,
              );
            },
          );
        } catch (error) {
          logger.debug("Scheduled platform dependency resolution failed", {
            projectId: queued.projectId,
            target: dependencyWritebackTargetKey(queued.target),
            specifierCount: batch.length,
            error: String(error),
          });
        } finally {
          for (const resolution of batch) {
            pendingPlatformResolutionAttempts.delete(resolution.attemptKey);
          }
        }
      }
    })
    .finally(() => {
      activePlatformFlushes.delete(queueKey);
      pendingPlatformResolutionPromises.delete(flush);
      if (
        (queuedPlatformResolutions.get(queueKey)?.resolutions.size ?? 0) > 0
      ) {
        schedulePlatformResolutionFlush(queueKey);
      }
    });

  activePlatformFlushes.set(queueKey, flush);
  pendingPlatformResolutionPromises.add(flush);
}

/** Override the platform write-back transport. For tests only. */
export function _setDependencyResolutionPosterForTest(
  poster?: DependencyResolutionPoster,
): void {
  postDependencyResolutionImpl = poster ?? postDependencyResolution;
}

/**
 * Fire-and-forget POST to the platform API to resolve and persist dependency
 * declarations.
 *
 * Uses the request-scoped bearer token when provided, with the runtime
 * environment token as a fallback. Silently ignores all failures including
 * 404 (endpoint may not exist yet while the API track is built in parallel).
 *
 * @param projectId  - project identifier from the render context
 * @param specifiers - raw bare names or package declarations such as
 *                     "pkg", "pkg@^1", "pkg@next", or "pkg@1.2.3"
 * @param target - canonical main or branch package.json write-back target
 * @param expectedDeclarations - package declarations observed in the immutable
 *                               caller snapshot; null means the package was absent
 * @param authToken - request-scoped bearer token; the runtime token remains the fallback
 */
export async function postDependencyResolution(
  projectId: string,
  specifiers: string[],
  target: DependencyWritebackTarget,
  expectedDeclarations: Readonly<Record<string, string | null>>,
  authToken?: string,
): Promise<void> {
  if (!isCanonicalDependencyWritebackTarget(target)) return;

  const { getEnvironmentConfig } = await import(
    "../../config/environment-config.ts"
  );
  const config = getEnvironmentConfig();
  // The environment snapshot only carries an explicitly exported token; a
  // stored `veryfront login` token is registered host-privately so project
  // code cannot read it out of the process environment. Falling back to
  // `getHostEnv` keeps the write-back authenticated for a CLI-authenticated
  // dev session, and a blank exported value must not shadow that credential.
  const snapshotToken = isBlank(config.apiToken) ? undefined : config.apiToken;
  const environmentToken = authToken || snapshotToken;
  const hostToken = environmentToken ? undefined : getHostEnv("VERYFRONT_API_TOKEN");
  const apiToken = environmentToken || hostToken;
  // The host-private credential must only be sent to a host-owned API origin.
  // `config.apiBaseUrl` can come from the project-scoped environment
  // (`VERYFRONT_API_BASE_URL`), and pairing the developer's stored login token
  // with a project-chosen destination would hand the credential to that
  // origin. Token and endpoint must come from the same authority: when the
  // host token wins, the destination resolves from the host environment (or
  // the default API base), never from the snapshot.
  const apiBaseUrl = hostToken ? resolveHostOwnedApiBaseUrl() : config.apiBaseUrl;

  if (!apiBaseUrl || !apiToken) {
    logger.debug("Skipping dependency resolution write-back: no API config", { projectId });
    return;
  }

  const url = `${apiBaseUrl}/projects/${encodeURIComponent(projectId)}/dependencies/resolve`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    // The credential may be the host-private stored login token, so the request
    // goes through the host transport rather than `globalThis.fetch`. A project
    // served in this process can replace the global, and a direct call would
    // hand it the `Authorization` header to read.
    //
    // This also puts the write-back under the host egress ceiling, which denies
    // private and loopback destinations. A deployment whose API base is
    // internal must set `VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS`; the write-back
    // is best-effort, so a blocked request degrades to a logged skip.
    const res = await guardedOutboundFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(
        target.kind === "branch"
          ? {
            specifiers,
            branch: target.branch,
            expected_declarations: expectedDeclarations,
          }
          : { specifiers, expected_declarations: expectedDeclarations },
      ),
      signal: controller.signal,
    });

    if (!res.ok && res.status !== 404) {
      logger.debug("Dependency resolution write-back returned non-OK status", {
        projectId,
        status: res.status,
      });
    }
    try {
      await res.body?.cancel();
    } catch {
      // The response status is all this best-effort transport consumes.
    }
  } catch (err) {
    logger.debug("Dependency resolution write-back failed", {
      projectId,
      error: String(err),
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Clear resolved versions. For use in tests only.
 *
 * This intentionally retains in-flight tracking: callers must still be able
 * to await already-started fetches via _pendingResolutions() so their handles
 * and timers do not escape test teardown. Tests that schedule work should
 * await _pendingResolutions() before calling this helper.
 */
export function _clearNpmVersionCache(): void {
  platformResolutionAttempts.clear();
  pendingPlatformResolutionAttempts.clear();
  queuedPlatformResolutions.clear();
  postDependencyResolutionImpl = postDependencyResolution;
  _nowFn = () => Date.now();
}

/**
 * Resolves when all in-flight background npm version resolutions have settled.
 *
 * For use in tests only. Call this in afterEach after any test that schedules
 * resolution for a package without a project declaration. Awaiting it ensures
 * no open fetch handles or AbortController timers remain when the Deno leak
 * sanitizer inspects test teardown.
 */
export async function _pendingResolutions(): Promise<void> {
  while (
    pendingPlatformResolutionPromises.size > 0 ||
    queuedPlatformResolutions.size > 0
  ) {
    const pending = [...pendingPlatformResolutionPromises];
    if (pending.length === 0) {
      await Promise.resolve();
      continue;
    }
    await Promise.allSettled(pending);
  }
}
