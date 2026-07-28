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
  moduleLimitWarned: boolean;
}

/**
 * Track modules loaded during current render for manifest recording.
 * Key: renderSessionId, Value: RenderSession
 */
const renderSessions = new Map<string, RenderSession>();
const MAX_ACTIVE_RENDER_SESSIONS = 2_000;
const MAX_MODULES_PER_RENDER_SESSION = 10_000;
const MAX_RENDER_SESSION_ID_CHARACTERS = 16 * 1024;
const MAX_RECORDED_MODULE_PATH_CHARACTERS = 16 * 1024;

function requireRenderSessionId(sessionId: string): string {
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.length > MAX_RENDER_SESSION_ID_CHARACTERS
  ) {
    throw new RangeError(
      `Render session ID must contain 1-${MAX_RENDER_SESSION_ID_CHARACTERS} characters`,
    );
  }
  return sessionId;
}

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
  return currentSessionIdStorage.run(requireRenderSessionId(sessionId), fn);
}

/**
 * Start a render session to track module loading.
 * Call this before rendering a page.
 */
export function startRenderSession(sessionId: string, projectSlug?: string, route?: string): void {
  const id = requireRenderSessionId(sessionId);
  if (renderSessions.has(id)) {
    throw new Error("Render session already exists");
  }
  if (renderSessions.size >= MAX_ACTIVE_RENDER_SESSIONS) {
    throw new Error(
      `Active render session limit reached (${MAX_ACTIVE_RENDER_SESSIONS})`,
    );
  }

  renderSessions.set(id, {
    modules: new Set(),
    projectSlug,
    route,
    moduleLimitWarned: false,
  });
  globalLogger.debug(`${LOG_PREFIX_MDX_LOADER} Started render session`, {
    sessionId: id,
    projectSlug,
    route,
  });
}

/**
 * End a render session and record loaded modules to the manifest.
 */
export function endRenderSession(sessionId: string): void {
  const id = requireRenderSessionId(sessionId);
  const session = renderSessions.get(id);
  if (!session) {
    globalLogger.warn(`${LOG_PREFIX_MDX_LOADER} End session called but no session found`, {
      sessionId: id,
    });
    return;
  }

  // Release process-lifetime state before logging or manifest publication.
  // A downstream failure must never strand the session in memory.
  renderSessions.delete(id);

  const modulePaths = Array.from(session.modules);
  globalLogger.debug(`${LOG_PREFIX_MDX_LOADER} End render session`, {
    sessionId: id,
    moduleCount: modulePaths.length,
    projectSlug: session.projectSlug,
    route: session.route,
    sampleModules: modulePaths.slice(0, 5),
  });

  if (session.projectSlug !== undefined && session.route !== undefined) {
    if (modulePaths.length > 0) recordSSRModules(session.projectSlug, session.route, modulePaths);
  } else {
    // This is normal in local dev/tests where projectSlug isn't set
    // The manifest is an optimization for production, not required
    globalLogger.debug(
      `${LOG_PREFIX_MDX_LOADER} Cannot record to manifest - missing projectSlug or route`,
      {
        projectSlug: session.projectSlug,
        route: session.route,
      },
    );
  }
}

/** Abandon a failed render without publishing its partial dependency graph. */
export function abortRenderSession(sessionId: string): void {
  const id = requireRenderSessionId(sessionId);
  if (!renderSessions.delete(id)) return;
  globalLogger.debug(`${LOG_PREFIX_MDX_LOADER} Aborted render session`, {
    sessionId: id,
  });
}

export function hasRenderSession(sessionId: string): boolean {
  return renderSessions.has(requireRenderSessionId(sessionId));
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
  if (
    normalizedPath.length === 0 ||
    normalizedPath.length > MAX_RECORDED_MODULE_PATH_CHARACTERS
  ) {
    globalLogger.warn(`${LOG_PREFIX_MDX_LOADER} Skipping invalid render-session module path`, {
      pathLength: normalizedPath.length,
    });
    return;
  }
  const moduleUrlPath = normalizedPath
    .replace(/^_vf_modules\//, "")
    .replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
  if (moduleUrlPath.length === 0 || session.modules.has(moduleUrlPath)) return;

  if (session.modules.size >= MAX_MODULES_PER_RENDER_SESSION) {
    if (!session.moduleLimitWarned) {
      session.moduleLimitWarned = true;
      globalLogger.warn(`${LOG_PREFIX_MDX_LOADER} Render session module limit reached`, {
        maxModules: MAX_MODULES_PER_RENDER_SESSION,
      });
    }
    return;
  }

  session.modules.add(moduleUrlPath);
}
