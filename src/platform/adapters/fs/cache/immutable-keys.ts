/********************************************************************************
 * Release-scoped file-cache key classification
 *
 * Decides whether a file-cache key embeds a release identity, which makes it
 * eligible for a process-local cache. Eligibility is not a claim that the value
 * never changes: production does invalidate these keys, so the store that uses
 * this predicate still needs an invalidation path.
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
 * makes the first two eligible:
 *
 * - `release`     -> qualifier is the `releaseId`. A release is a snapshot, so
 *                    activating another one produces a different key rather
 *                    than a new value behind this one.
 * - `env`         -> qualifier is `environmentName` + the **`releaseId`**, so
 *                    it inherits the same property.
 * - `branch`      -> qualifier is a branch name, whose content changes on every
 *                    save. Never eligible.
 *
 * That distinction is the safety argument against the failure in
 * veryfront-issue-inbox#39, where a shared proxy kept serving a previous
 * release from a process-local cache after activation. That cache was keyed on
 * a *pointer that moved*. These keys are not.
 *
 * It is not a claim that the value behind an eligible key is immutable. The
 * renderer invalidates `file:release:`, `file:env:`, `stat:release:`,
 * `stat:env:`, `dir:*` and `files:*` (see the prefix clears in
 * `veryfront/websocket-manager.ts` and `veryfront/adapter.ts`), and a
 * process-local store built on this predicate must honour those invalidations.
 * What eligibility buys is that a stale entry cannot survive a release
 * activation, not that no entry ever goes stale.
 *
 * The match is an anchored allow-list rather than a segment scan, because the
 * dangerous mistake is classifying a branch key as release-scoped. Only the
 * four prefixes that actually route through `buildFileOperationPrefix` are
 * accepted (`file`, `stat`, `dir`, `files`). Anything else, including
 * `github:*` keys, the `*:unknown` fallbacks used when there is no file
 * operation context, and every `branch` key, simply does not get the
 * optimisation.
 */
const IMMUTABLE_FILE_CACHE_KEY = /^(?:file|stat|dir|files):(?:release|env):/;

/** Whether `key` embeds a release identity, so a process-local copy is eligible. */
export function isImmutableFileCacheKey(key: string): boolean {
  return IMMUTABLE_FILE_CACHE_KEY.test(key);
}
