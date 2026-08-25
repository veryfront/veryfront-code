/**
 * Per-request context entry for contextual filesystem adapters.
 *
 * A non-multi-project contextual adapter is reused across requests and keeps
 * the token, branch, and production mode of whatever request it served last.
 * Every handler that reads project source for a request must first point the
 * adapter at the context that request addresses, and they must all agree on
 * what that context is: the API/page classifier prepares source freshness and
 * classifies route ownership before `SSRHandler` renders, so both entering
 * different contexts would classify one branch and render another.
 *
 * @module server/handlers/request/contextual-adapter-context
 */

import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext } from "../types.ts";
import { isProductionMode } from "./route-visibility-policy.ts";

const logger = serverLogger.component("request-context");

/**
 * Point a reused contextual adapter at the context this request addresses.
 *
 * No-op for adapters that are not contextual (local filesystems, multi-project
 * adapters entered through `runWithContext`).
 */
export function enterContextualAdapterRequestContext(ctx: HandlerContext): void {
  const fsAdapter = ctx.adapter.fs;
  if (!isExtendedFSAdapter(fsAdapter) || !fsAdapter.isContextualMode()) return;

  // setRequestToken and setRequestBranch are optional per-request context hints;
  // some adapters may not support them. Swallow those errors gracefully.
  try {
    if (ctx.proxyToken) fsAdapter.setRequestToken(ctx.proxyToken);
    fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);
  } catch (e) {
    logger.warn("Non-critical adapter context setup failed (token/branch)", {
      error: e instanceof Error ? e.message : String(e),
      projectSlug: ctx.projectSlug,
    });
  }

  // setProductionMode is more important than the token/branch hints: if it
  // silently no-ops the request could run in the wrong environment. Adapters
  // that don't implement it may still throw, so keep it non-fatal but surface
  // the failure at warn (rather than swallowing it) so a genuinely broken
  // production-mode setup is visible instead of silently serving draft content.
  try {
    const prodMode = isProductionMode(ctx);
    fsAdapter.setProductionMode(prodMode, ctx.releaseId);
  } catch (e) {
    logger.warn("Adapter setProductionMode failed", {
      error: e instanceof Error ? e.message : String(e),
      projectSlug: ctx.projectSlug,
    });
  }
}
