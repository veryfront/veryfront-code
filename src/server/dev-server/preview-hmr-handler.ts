/**
 * Preview HMR Handler
 *
 * Handles WebSocket connections for Hot Module Replacement using PreviewBundler.
 * Integrates esbuild watch mode with HMR notifications to connected browsers.
 *
 * @module server/dev-server/preview-hmr-handler
 */

import { serverLogger as logger } from "#veryfront/utils";
import { getPreviewBundler, type PreviewBundler } from "#veryfront/bundler/preview-bundler.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export interface PreviewHmrHandlerOptions {
  /** Project identifier */
  projectId: string;
  /** Project directory */
  projectDir: string;
  /** Runtime adapter */
  adapter: RuntimeAdapter;
  /** HMR port (for runtime generation) */
  hmrPort?: number;
  /** React version */
  reactVersion?: string;
}

/**
 * Preview HMR Handler
 *
 * Manages HMR WebSocket connections and rebuilds using PreviewBundler's
 * esbuild watch mode for fast incremental updates.
 */
export class PreviewHmrHandler {
  private bundler: PreviewBundler;
  private projectId: string;
  private projectDir: string;
  private adapter: RuntimeAdapter;
  private reactVersion?: string;
  private initialized = false;

  constructor(options: PreviewHmrHandlerOptions) {
    this.bundler = getPreviewBundler({ hmrPort: options.hmrPort });
    this.projectId = options.projectId;
    this.projectDir = options.projectDir;
    this.adapter = options.adapter;
    this.reactVersion = options.reactVersion;
  }

  /**
   * Handle WebSocket upgrade for HMR connection
   */
  handleWebSocketUpgrade(req: Request, server: {
    upgradeWebSocket: (req: Request) => { socket: WebSocket; response: Response };
  }): Response | null {
    const url = new URL(req.url);

    // Only handle /_vf/hmr endpoint
    if (url.pathname !== "/_vf/hmr") {
      return null;
    }

    const upgrade = req.headers.get("upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return null;
    }

    const projectId = url.searchParams.get("project") || this.projectId;

    try {
      const { socket, response } = server.upgradeWebSocket(req);

      // Register the client with PreviewBundler
      this.bundler.registerHmrClient(projectId, socket);

      // Handle client disconnect
      socket.addEventListener("close", () => {
        this.bundler.unregisterHmrClient(projectId, socket);
        logger.debug("[PreviewHmr] Client disconnected", { projectId });
      });

      socket.addEventListener("error", (error) => {
        logger.debug("[PreviewHmr] Client error", { projectId, error: String(error) });
        this.bundler.unregisterHmrClient(projectId, socket);
      });

      logger.debug("[PreviewHmr] Client connected", {
        projectId,
        stats: this.bundler.getStats(),
      });

      return response;
    } catch (error) {
      logger.error("[PreviewHmr] Failed to upgrade WebSocket", { error: String(error) });
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
  }

  /**
   * Initialize PreviewBundler with the project
   * Called on first file change or request
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.bundler.getContext(this.projectId, this.projectDir, this.adapter, {
        reactVersion: this.reactVersion,
      });
      this.initialized = true;
      logger.debug("[PreviewHmr] Bundler initialized", { projectId: this.projectId });
    } catch (error) {
      logger.error("[PreviewHmr] Failed to initialize bundler", { error: String(error) });
    }
  }

  /**
   * Trigger a rebuild after file changes
   * Called by FileWatchSetup when files change
   */
  async triggerRebuild(changedFiles: string[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const startTime = performance.now();
      await this.bundler.rebuild(this.projectId);
      const duration = performance.now() - startTime;

      logger.debug("[PreviewHmr] Rebuild complete", {
        projectId: this.projectId,
        changedFiles: changedFiles.length,
        durationMs: duration.toFixed(2),
      });
    } catch (error) {
      logger.error("[PreviewHmr] Rebuild failed", {
        projectId: this.projectId,
        error: String(error),
      });
    }
  }

  /**
   * Get the HMR runtime script
   */
  getHmrRuntime(): string {
    return this.bundler.getHmrRuntime(this.projectId);
  }

  /**
   * Get bundler statistics
   */
  getStats(): ReturnType<PreviewBundler["getStats"]> {
    return this.bundler.getStats();
  }

  /**
   * Shutdown the handler and cleanup resources
   */
  async shutdown(): Promise<void> {
    await this.bundler.stopWatching(this.projectId);
    logger.debug("[PreviewHmr] Handler shutdown", { projectId: this.projectId });
  }
}

/**
 * Create a preview HMR handler for the dev server
 */
export function createPreviewHmrHandler(options: PreviewHmrHandlerOptions): PreviewHmrHandler {
  return new PreviewHmrHandler(options);
}
