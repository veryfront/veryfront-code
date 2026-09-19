/**
 * Process-wide single-flight for entry module fetches.
 *
 * Concurrent renders of the same page each start module resolution at the same
 * `/_vf_modules/*` entry imports. Without sharing, every request walks the
 * whole dependency graph on its own and repeats every distributed cache read,
 * which multiplies the load on a cold instance by the number of concurrent
 * requests. Entry fetches with the same identity share one in-flight
 * resolution instead.
 *
 * Only entry fetches (no parent module) are shared. Nested fetches stay scoped
 * to the request that owns the resolution, so a shared resolution never waits
 * on another shared resolution and two requests cannot deadlock on a cycle.
 *
 * Entries are removed as soon as the resolution settles: resolved paths are
 * served from the module path cache afterwards, and a rejected resolution is
 * retried by the next request instead of being cached.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/shared-module-fetches
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import type { ModuleFetcherContext } from "../types.ts";
import { recordModuleToSession, runWithModuleRecorder } from "./render-sessions.ts";

/**
 * Last-resort age after which a never-settling shared resolution stops
 * accepting new callers. The transform tree deadline normally settles a
 * resolution well before this.
 */
const SHARED_MODULE_FETCH_STALE_AFTER_MS = 60_000;

interface SharedModuleFetchResult {
  path: string | null;
  /** Modules the resolution recorded, replayed into each caller's render session. */
  recordedModules: ReadonlySet<string>;
}

let sharedModuleFetches = new Singleflight<SharedModuleFetchResult>();

/** Marks async work that already runs inside a shared resolution. */
const sharedResolutionScope = new AsyncLocalStorage<true>();

/**
 * Build the identity of an entry fetch. Every input that changes the resolved
 * module is part of the key, so results never cross projects, content
 * sources, compile modes, or dependency snapshots.
 */
export function getSharedModuleFetchKey(
  context: ModuleFetcherContext,
  bindingKey: string,
): string {
  return JSON.stringify([
    context.projectId,
    context.contentSourceId ?? "",
    context.esmCacheDir,
    context.projectDir,
    context.isLocalProject === true,
    context.dev === true,
    context.reactVersion ?? REACT_DEFAULT_VERSION,
    context.dependencyPinningCacheKey ?? "off",
    context.moduleServerOrigin ?? "",
    [...(context.serverExternalPackages ?? [])].sort(compareStrings),
    context.strictMissingModules ?? true,
    bindingKey,
  ]);
}

/** Per-caller hooks for a shared entry fetch. */
export interface SharedModuleFetchOptions {
  /**
   * Called with every module the resolution recorded, before the caller gets
   * the result. A throw rejects only this caller.
   */
  onResolved?: (recordedModules: ReadonlySet<string>) => void;
  /**
   * Whether a caller that joined another caller's resolution runs `resolve`
   * itself after that resolution failed with `error`. Use it for failures that
   * belong to the leading caller, such as its own deadline.
   */
  retryAloneOn?: (error: unknown) => boolean;
}

/**
 * Run `resolve` once per key across concurrent callers in this process.
 *
 * A call made from inside a shared resolution runs `resolve` directly, so a
 * shared resolution never waits on another one.
 */
export async function runSharedModuleFetch(
  key: string,
  resolve: () => Promise<string | null>,
  options: SharedModuleFetchOptions = {},
): Promise<string | null> {
  if (sharedResolutionScope.getStore()) return await resolve();

  let leading = false;
  let result: SharedModuleFetchResult;
  try {
    result = await sharedModuleFetches.do(
      key,
      () => {
        leading = true;
        const recordedModules = new Set<string>();
        return sharedResolutionScope.run(
          true,
          () =>
            runWithModuleRecorder(recordedModules, async () => ({
              path: await resolve(),
              recordedModules,
            })),
        );
      },
      { staleAfterMs: SHARED_MODULE_FETCH_STALE_AFTER_MS },
    );
  } catch (error) {
    if (leading || !options.retryAloneOn?.(error)) throw error;
    return await resolve();
  }

  options.onResolved?.(result.recordedModules);
  for (const modulePath of result.recordedModules) recordModuleToSession(modulePath);
  return result.path;
}

/**
 * Stop new callers from joining resolutions that started before a content
 * invalidation. Running resolutions finish for the callers already waiting.
 */
export function resetSharedModuleFetches(): void {
  sharedModuleFetches = new Singleflight<SharedModuleFetchResult>();
}

/** Number of shared resolutions currently in flight. */
export function getSharedModuleFetchCount(): number {
  return sharedModuleFetches.size;
}
