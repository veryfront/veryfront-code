/**
 * Low-level project environment contract shared by server admission and
 * routing worker boundaries.
 *
 * Keep this module free of runtime and server dependencies so higher layers
 * can share one immutable contract without reversing dependency direction.
 *
 * @module platform/compat/process/project-env-contract
 */

const objectFreeze = Object.freeze;

/** Immutable project environment admitted to runtime and worker boundaries. */
export type ProjectEnvSnapshot = Readonly<Record<string, string>>;

/** Fixed resource limits for every project environment admission boundary. */
export const PROJECT_ENV_SNAPSHOT_LIMITS = objectFreeze({
  // The API returns at most 100 tenant entries. Runtime-owned scoped values
  // may be added afterward without exceeding this boundary.
  maxEntries: 128,
  maxKeyChars: 1_024,
  maxValueChars: 1024 * 1024,
  maxUtf8Bytes: 1024 * 1024,
});
