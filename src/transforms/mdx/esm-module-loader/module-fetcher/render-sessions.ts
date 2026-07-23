/**
 * Render session tracking for module manifest recording.
 *
 * Tracks modules loaded during SSR rendering to build route-module manifests.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/render-sessions
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { rendererLogger as globalLogger } from "#veryfront/utils";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { recordSSRModules } from "#veryfront/modules/manifest/route-module-manifest.ts";

/**
 * Render session state for module tracking.
 */
interface RenderSession {
  modules: Set<string>;
  projectSlug?: string;
  route?: string;
}

/**
 * Track modules loaded during current render for manifest recording.
 * Key: renderSessionId, Value: RenderSession
 */
const renderSessions = new Map<string, RenderSession>();

/**
 * The render session id active on the current async execution context.
 * Set via {@link runInRenderSession} so concurrent SSR renders each resolve
 * their own session instead of sharing whichever one started first.
 */
const currentSessionIdStorage = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `sessionId` bound as the active render session for all async
 * work it spawns. Modules fetched inside are attributed to this session.
 */
export function runInRenderSession<T>(sessionId: string, fn: () => T): T {
  return currentSessionIdStorage.run(sessionId, fn);
}

/**
 * Start a render session to track module loading.
 * Call this before rendering a page.
 */
export function startRenderSession(sessionId: string, projectSlug?: string, route?: string): void {
  renderSessions.set(sessionId, { modules: new Set(), projectSlug, route });
  globalLogger.debug(`${LOG_PREFIX_MDX_LOADER} Started render session`, {
    hasProject: projectSlug !== undefined,
    hasRoute: route !== undefined,
  });
}

/**
 * End a render session and record loaded modules to the manifest.
 */
export function endRenderSession(sessionId: string): void {
  const session = renderSessions.get(sessionId);
  if (!session) {
    globalLogger.warn(`${LOG_PREFIX_MDX_LOADER} End session called but no session found`);
    return;
  }

  const modulePaths = Array.from(session.modules);
  globalLogger.debug(`${LOG_PREFIX_MDX_LOADER} End render session`, {
    moduleCount: modulePaths.length,
    hasProject: session.projectSlug !== undefined,
    hasRoute: session.route !== undefined,
  });

  if (session.projectSlug !== undefined && session.route !== undefined) {
    if (modulePaths.length > 0) recordSSRModules(session.projectSlug, session.route, modulePaths);
  } else {
    // This is normal in local dev/tests where projectSlug isn't set
    // The manifest is an optimization for production, not required
    globalLogger.debug(
      `${LOG_PREFIX_MDX_LOADER} Cannot record to manifest - missing projectSlug or route`,
      {
        hasProject: session.projectSlug !== undefined,
        hasRoute: session.route !== undefined,
      },
    );
  }

  renderSessions.delete(sessionId);
}

export function hasRenderSession(sessionId: string): boolean {
  return renderSessions.has(sessionId);
}

/**
 * Get the current active render session (if any).
 * Used to record modules during fetch and for per-session in-flight deduplication.
 */
function getCurrentSession(): RenderSession | null {
  const activeId = currentSessionIdStorage.getStore();
  if (activeId !== undefined) {
    return renderSessions.get(activeId) ?? null;
  }

  // No session bound on the async context (caller not wrapped in
  // runInRenderSession). Fall back to the single-session heuristic only when
  // it is unambiguous; with multiple concurrent sessions, decline rather than
  // mis-attribute modules to the wrong render.
  if (renderSessions.size === 1) {
    const firstSession = renderSessions.values().next();
    return firstSession.done ? null : firstSession.value;
  }
  return null;
}

export function recordModuleToSession(normalizedPath: string): void {
  const session = getCurrentSession();
  if (!session) return;

  const moduleUrlPath = normalizedPath
    .replace(/^_vf_modules\//, "")
    .replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
  session.modules.add(moduleUrlPath);
}
