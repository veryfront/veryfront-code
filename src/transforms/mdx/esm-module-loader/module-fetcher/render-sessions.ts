/**
 * Render session tracking for module manifest recording.
 *
 * Tracks modules loaded during SSR rendering to build route-module manifests.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/render-sessions
 */

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
 * Start a render session to track module loading.
 * Call this before rendering a page.
 */
export function startRenderSession(sessionId: string, projectSlug?: string, route?: string): void {
  renderSessions.set(sessionId, { modules: new Set(), projectSlug, route });
  globalLogger.debug(`${LOG_PREFIX_MDX_LOADER} Started render session`, {
    sessionId,
    projectSlug,
    route,
  });
}

/**
 * End a render session and record loaded modules to the manifest.
 */
export function endRenderSession(sessionId: string): void {
  const session = renderSessions.get(sessionId);
  if (!session) {
    globalLogger.warn(`${LOG_PREFIX_MDX_LOADER} End session called but no session found`, {
      sessionId,
    });
    return;
  }

  const modulePaths = Array.from(session.modules);
  globalLogger.debug(`${LOG_PREFIX_MDX_LOADER} End render session`, {
    sessionId,
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

  renderSessions.delete(sessionId);
}

/**
 * Get the current active render session (if any).
 * Used to record modules during fetch and for per-session in-flight deduplication.
 */
export function getCurrentSession(): RenderSession | null {
  const firstSession = renderSessions.values().next();
  return firstSession.done ? null : firstSession.value;
}

export function recordModuleToSession(normalizedPath: string): void {
  const session = getCurrentSession();
  if (!session) return;

  const moduleUrlPath = normalizedPath
    .replace(/^_vf_modules\//, "")
    .replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
  session.modules.add(moduleUrlPath);
}
