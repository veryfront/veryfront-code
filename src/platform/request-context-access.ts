/**
 * Client-safe access to the hosted request context.
 *
 * The real context lives in an AsyncLocalStorage inside
 * `adapters/fs/veryfront/request-context.ts`, whose module-scope
 * `node:async_hooks` import must stay out of browser bundles. Shared
 * client/server code (the config loader's hosted-identity assertions) reads
 * the context through this holder instead: the server module registers its
 * accessor when it loads, and in the browser nothing ever registers, so
 * `currentRequestContext()` returns null — the correct answer there, since a
 * hosted request context only exists while the server VFS adapter runs a
 * request.
 *
 * Registration cannot be observed "too early": the only writer of the
 * context (`multi-project-adapter.ts`'s `asyncLocalStorage.run`) imports the
 * server module, so any populated context implies the accessor is in place.
 */

import type { RequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";

export type { RequestContext };

let accessor: (() => RequestContext | null) | undefined;

/** Called by the server request-context module when it loads. */
export function registerRequestContextAccessor(
  fn: () => RequestContext | null,
): void {
  accessor = fn;
}

/** The current hosted request context, or null outside a server request. */
export function currentRequestContext(): RequestContext | null {
  return accessor?.() ?? null;
}
