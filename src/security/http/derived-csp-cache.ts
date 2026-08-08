/**
 * Per-release cache for {@link deriveCspOriginsFromSource}.
 *
 * Derivation reads every source file a release pins, which is far too much work
 * to repeat per response but exactly the right amount to do once per release:
 * the input is immutable for a given content version, so the result is too.
 *
 * @module security/http/derived-csp-cache
 */

import { registerCache } from "#veryfront/utils/memory/index.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  type DerivationSourceFile,
  deriveCspOriginsFromSource,
  type DerivedCspOrigins,
} from "./derived-csp-origins.ts";

const logger = serverLogger.component("derived-csp");

/** Bounded so a fleet of projects cannot grow this without limit. */
const MAX_ENTRIES = 200;

const EMPTY: DerivedCspOrigins = Object.freeze({});

const cache = new Map<string, DerivedCspOrigins>();

/**
 * Derivations currently running, keyed exactly as the resolved cache is.
 *
 * A key is coldest immediately after a release, when every pod serves that
 * content version for the first time. Without this, each concurrent request for
 * the same key reads and scans the whole source set; with it the first caller
 * does the work and the rest await its result.
 */
const inFlight = new Map<string, Promise<DerivedCspOrigins>>();

registerCache("derived-csp-origins", () => ({
  name: "derived-csp-origins",
  entries: cache.size,
  maxEntries: MAX_ENTRIES,
}));

/**
 * Content versions already reported as underivable.
 *
 * The two failure paths deliberately do not `remember`, so the read is retried
 * on the next request -- which means without this they would warn on every
 * request for as long as the failure lasts, on every pod. The diagnostic is
 * worth one line per content version, not one per request.
 *
 * Bounded like the cache, and for the same reason.
 */
const warned = new Set<string>();

/** @returns whether this key's diagnostic has not been emitted yet */
export function shouldWarnOnceForKey(key: string): boolean {
  if (warned.has(key)) return false;
  while (warned.size >= MAX_ENTRIES) {
    const oldest = warned.values().next().value as string | undefined;
    if (oldest === undefined) break;
    warned.delete(oldest);
  }
  warned.add(key);
  return true;
}

function remember(key: string, value: DerivedCspOrigins): DerivedCspOrigins {
  // Insertion-ordered eviction: the oldest content version is the one least
  // likely to still be serving traffic.
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

export interface DerivedCspLookup {
  /** Project scope, so two projects on one pod cannot share an entry. */
  readonly projectScope: string;
  /**
   * Content version, as `resolveStyleContentVersion` spells it. A branch
   * version is stable while its content changes, which is why the caller passes
   * a snapshot identity rather than a branch name where one is available.
   */
  readonly contentVersion: string;
  /** Reads the release's source files. Called only on a miss. */
  readonly loadSourceFiles: () => Promise<readonly DerivationSourceFile[] | null>;
}

/**
 * Derived origins for a content version, computing them at most once.
 *
 * Failure is not fatal: a project whose sources cannot be read gets an empty
 * derivation, which leaves it exactly where it was before this existed -- the
 * platform floor plus whatever `security.csp` declares.
 */
export function getDerivedCspOrigins(
  lookup: DerivedCspLookup,
): Promise<DerivedCspOrigins> {
  // NUL separates the two components because neither can contain one, so no
  // scope/version pair can collide with another by concatenation. Written as an
  // escape rather than a raw byte: a literal NUL in the source makes the file
  // binary to grep and friends.
  const key = `${lookup.projectScope}\u0000${lookup.contentVersion}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const derivation = deriveOnce(key, lookup);
  inFlight.set(key, derivation);
  return derivation.finally(() => {
    // Clear only our own entry: after an eviction a later call may already have
    // started a fresh derivation under the same key.
    if (inFlight.get(key) === derivation) inFlight.delete(key);
  });
}

async function deriveOnce(
  key: string,
  lookup: DerivedCspLookup,
): Promise<DerivedCspOrigins> {
  let files: readonly DerivationSourceFile[] | null;
  try {
    files = await lookup.loadSourceFiles();
  } catch (error) {
    // Warn, not debug. Every path out of this function is a silent `EMPTY`, so
    // a derivation that never works looks exactly like a project that
    // references no external origins. That is how this shipped doing nothing
    // in production while reading as healthy.
    if (shouldWarnOnceForKey(key)) {
      logger.warn("CSP derivation could not read project sources", {
        projectScope: lookup.projectScope,
        contentVersion: lookup.contentVersion,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Deliberately not remembered. See below.
    return EMPTY;
  }

  // An empty read is not an answer, and caching it is the difference between
  // this feature working and doing nothing at all.
  //
  // `getAllSourceFiles` returns [] whenever its own file list is cold, warming
  // it asynchronously afterwards. Every pod is cold for a content version on
  // the first request after a release, so remembering that emptiness pinned the
  // release to the bare floor for the life of the pod -- the warm file list
  // that arrived a moment later was never consulted again. Hosted production
  // projects, the ones this exists for, saw derivation do nothing at all, while
  // preview appeared to work whenever its file list happened to be warm.
  //
  // So distinguish the two cases: files read and no origins found is immutable
  // for the content version and worth caching, while nothing read is a race and
  // must be retried.
  if (!files || files.length === 0) {
    if (shouldWarnOnceForKey(key)) {
      logger.warn("CSP derivation read no project sources", {
        projectScope: lookup.projectScope,
        contentVersion: lookup.contentVersion,
      });
    }
    return EMPTY;
  }

  const derived = deriveCspOriginsFromSource(files);
  const count = derived["img-src"]?.length ?? 0;

  // Logged once per content version, because that is exactly what the cache key
  // is, so this cannot grow with traffic. Both outcomes are recorded: "read 40
  // files, derived 0 origins" is the shape of a broken derivation, and it is
  // indistinguishable from a correct one unless the file count is stated.
  logger.info("Derived CSP origins from project source", {
    projectScope: lookup.projectScope,
    contentVersion: lookup.contentVersion,
    fileCount: files.length,
    filesWithContent: files.filter((file) =>
      typeof file.content === "string" && file.content !== ""
    )
      .length,
    originCount: count,
  });

  return remember(key, derived);
}

/** @internal Test seam. */
export function __clearDerivedCspCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  warned.clear();
}
