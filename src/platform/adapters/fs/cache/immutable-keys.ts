/********************************************************************************
 * Immutable file-cache key classification
 *
 * Decides whether a file-cache key denotes content that can never change, and
 * is therefore safe to hold in a process-local cache with no invalidation path.
 *
 * @module platform/adapters/fs/cache/immutable-keys
 ********************************************************************************/

/**
 * File-operation keys are built by `buildFileOperationPrefix`
 * (`cache/keys/builders/file.ts`) as:
 *
 *     {prefix}:{sourceTypeKey}:{projectSlug}:{qualifier}
 *
 * `sourceTypeKey` is `release`, `env` or `branch`, and the qualifier is what
 * makes the first two safe:
 *
 * - `release`     -> qualifier is the `releaseId`. A release is an immutable
 *                    snapshot.
 * - `env`         -> qualifier is `environmentName` + the **`releaseId`**.
 *                    Activating a new release does not change the value behind
 *                    an existing key; it produces a *different* key.
 * - `branch`      -> qualifier is a branch name, whose content changes on every
 *                    save. Never immutable.
 *
 * That distinction is the whole safety argument. veryfront-issue-inbox#39 exists
 * because a shared proxy kept serving a previous release from a process-local
 * cache after activation — but that cache was keyed on a *pointer that moved*.
 * These keys embed the release identity, so the same failure cannot occur.
 *
 * The match is an anchored allow-list rather than a segment scan, because the
 * dangerous mistake is classifying a mutable key as immutable. Only the four
 * prefixes that actually route through `buildFileOperationPrefix` are accepted
 * (`file`, `stat`, `dir`, `files`); anything else — including `github:*` keys,
 * the `*:unknown` fallbacks used when there is no file operation context, and
 * every `branch` key — is treated as mutable and simply does not get the
 * optimisation.
 */
const IMMUTABLE_FILE_CACHE_KEY = /^(?:file|stat|dir|files):(?:release|env):/;

/** Whether `key` denotes content that cannot change, so it needs no invalidation. */
export function isImmutableFileCacheKey(key: string): boolean {
  return IMMUTABLE_FILE_CACHE_KEY.test(key);
}
