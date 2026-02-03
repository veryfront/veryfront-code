/**
 * Preview Bundler with esbuild Watch Mode and HMR
 *
 * Provides fast development experience with:
 * - esbuild watch mode for incremental rebuilds (~10-50ms)
 * - WebSocket-based HMR for instant browser updates
 * - Multi-project context management with LRU eviction
 * - Local-only caching (no distributed cache needed)
 *
 * Performance characteristics:
 * - Initial build: ~100-200ms
 * - Incremental rebuild: ~10-50ms
 * - HMR update to browser: ~5-10ms
 *
 * @module bundler/preview-bundler
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { Span } from "@opentelemetry/api";
import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import type { BuildContext, BuildResult, Metafile } from "esbuild";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { joinPath } from "#veryfront/utils/path-utils.ts";
import {
  type BundleConfig,
  createBareImportPlugin,
  createHmrRuntime,
  createPreviewBuildOptions,
  createVirtualFsPlugin,
} from "./build-config.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";

export interface ProjectContext {
  /** esbuild build context */
  ctx: BuildContext;
  /** Last activity timestamp */
  lastActivity: number;
  /** Project identifier */
  projectId: string;
  /** Project directory */
  projectDir: string;
  /** Current bundle output */
  currentBundle: string | null;
  /** Current metafile */
  currentMetafile: Metafile | null;
  /** Build errors */
  errors: string[];
}

export interface PreviewBundlerConfig {
  /** Maximum concurrent project contexts */
  maxContexts?: number;
  /** Context eviction timeout in milliseconds */
  evictionTimeoutMs?: number;
  /** HMR WebSocket port */
  hmrPort?: number;
}

export interface HmrMessage {
  type: "update" | "full-reload" | "error" | "connected";
  projectId?: string;
  modules?: string[];
  error?: string;
  timestamp?: number;
}

// Default configuration
const DEFAULT_MAX_CONTEXTS = 50;
const DEFAULT_EVICTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_HMR_PORT = 3001;

/**
 * Preview Bundler Manager
 *
 * Manages esbuild contexts for multiple projects with:
 * - LRU eviction when at capacity
 * - Automatic cleanup of inactive contexts
 * - HMR notification to connected browsers
 */
export class PreviewBundler {
  private contexts = new Map<string, ProjectContext>();
  private maxContexts: number;
  private evictionTimeoutMs: number;
  private hmrPort: number;
  private hmrClients = new Map<string, Set<WebSocket>>();
  private evictionInterval: number | null = null;

  constructor(config: PreviewBundlerConfig = {}) {
    this.maxContexts = config.maxContexts ?? DEFAULT_MAX_CONTEXTS;
    this.evictionTimeoutMs = config.evictionTimeoutMs ?? DEFAULT_EVICTION_TIMEOUT_MS;
    this.hmrPort = config.hmrPort ?? DEFAULT_HMR_PORT;

    // Start eviction timer
    this.startEvictionTimer();
  }

  /**
   * Get or create an esbuild context for a project
   */
  async getContext(
    projectId: string,
    projectDir: string,
    adapter: RuntimeAdapter,
    options: {
      entryPoint?: string;
      reactVersion?: string;
    } = {},
  ): Promise<ProjectContext> {
    const { entryPoint = "app.tsx", reactVersion = REACT_DEFAULT_VERSION } = options;

    // Update last activity for existing context
    const existing = this.contexts.get(projectId);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing;
    }

    // Evict oldest context if at capacity
    if (this.contexts.size >= this.maxContexts) {
      this.evictOldestContext();
    }

    // Create new context
    return withSpan(
      "bundler.preview.createContext",
      async (span?: Span) => {
        span?.setAttributes({
          "project.id": projectId,
          "project.dir": projectDir,
          "entry.point": entryPoint,
        });

        const esbuild = await getEsbuild();
        const entryPath = joinPath(projectDir, entryPoint);

        const buildConfig: BundleConfig = {
          projectId,
          projectDir,
          adapter,
          reactVersion,
          dev: true,
          target: "browser",
          entryPoints: [entryPath],
        };

        const buildOptions = createPreviewBuildOptions(buildConfig, this.hmrPort);

        // Add plugins
        buildOptions.plugins = [
          createVirtualFsPlugin(projectDir, adapter),
          createBareImportPlugin({ reactVersion, externalizeReact: true }),
          this.createHmrNotifyPlugin(projectId),
        ];

        const ctx = await esbuild.context(buildOptions);

        const projectContext: ProjectContext = {
          ctx,
          lastActivity: Date.now(),
          projectId,
          projectDir,
          currentBundle: null,
          currentMetafile: null,
          errors: [],
        };

        this.contexts.set(projectId, projectContext);
        logger.debug("[PreviewBundler] Created context", { projectId });

        return projectContext;
      },
      { "bundler.operation": "createContext" },
    );
  }

  /**
   * Build or rebuild a project
   */
  async build(
    projectId: string,
    projectDir: string,
    adapter: RuntimeAdapter,
    options: {
      entryPoint?: string;
      reactVersion?: string;
    } = {},
  ): Promise<string> {
    return withSpan(
      "bundler.preview.build",
      async (span?: Span) => {
        const projectContext = await this.getContext(projectId, projectDir, adapter, options);

        try {
          const result = await projectContext.ctx.rebuild();

          if (result.errors.length > 0) {
            projectContext.errors = result.errors.map((e) => e.text);
            this.notifyHmrClients(projectId, {
              type: "error",
              projectId,
              error: projectContext.errors.join("\n"),
            });
            throw new Error(`Build failed: ${projectContext.errors.join("\n")}`);
          }

          projectContext.errors = [];

          const output = result.outputFiles?.[0];
          if (!output) {
            throw new Error("Build produced no output");
          }

          const code = new TextDecoder().decode(output.contents);
          projectContext.currentBundle = code;
          projectContext.currentMetafile = result.metafile ?? null;

          span?.setAttribute("bundle.size", code.length);

          return code;
        } catch (error) {
          span?.setAttribute("error", true);
          span?.setAttribute("error.message", String(error));
          throw error;
        }
      },
      { "bundler.operation": "build" },
    );
  }

  /**
   * Trigger an incremental rebuild after file changes
   */
  async rebuild(projectId: string): Promise<string> {
    const projectContext = this.contexts.get(projectId);
    if (!projectContext) {
      throw new Error(`No context found for project: ${projectId}`);
    }

    return withSpan(
      "bundler.preview.rebuild",
      async (span?: Span) => {
        projectContext.lastActivity = Date.now();

        const startTime = performance.now();
        const result = await projectContext.ctx.rebuild();
        const rebuildTime = performance.now() - startTime;

        span?.setAttributes({
          "rebuild.time.ms": rebuildTime,
          "errors.count": result.errors.length,
        });

        if (result.errors.length > 0) {
          projectContext.errors = result.errors.map((e) => e.text);
          this.notifyHmrClients(projectId, {
            type: "error",
            projectId,
            error: projectContext.errors.join("\n"),
          });
          throw new Error(`Rebuild failed: ${projectContext.errors.join("\n")}`);
        }

        projectContext.errors = [];

        const output = result.outputFiles?.[0];
        if (!output) {
          throw new Error("Rebuild produced no output");
        }

        const code = new TextDecoder().decode(output.contents);
        projectContext.currentBundle = code;
        projectContext.currentMetafile = result.metafile ?? null;

        // Notify HMR clients
        const updatedModules = this.getUpdatedModules(result);
        this.notifyHmrClients(projectId, {
          type: "update",
          projectId,
          modules: updatedModules,
          timestamp: Date.now(),
        });

        logger.debug("[PreviewBundler] Rebuild complete", {
          projectId,
          rebuildTimeMs: rebuildTime.toFixed(2),
          modules: updatedModules.length,
        });

        return code;
      },
      { "bundler.operation": "rebuild" },
    );
  }

  /**
   * Start watching a project for file changes
   */
  async watch(
    projectId: string,
    projectDir: string,
    adapter: RuntimeAdapter,
    options: {
      entryPoint?: string;
      reactVersion?: string;
    } = {},
  ): Promise<void> {
    const projectContext = await this.getContext(projectId, projectDir, adapter, options);

    // Perform initial build
    await this.build(projectId, projectDir, adapter, options);

    // Start watching
    await projectContext.ctx.watch();

    logger.debug("[PreviewBundler] Watching for changes", { projectId, projectDir });
  }

  /**
   * Stop watching a project
   */
  async stopWatching(projectId: string): Promise<void> {
    const projectContext = this.contexts.get(projectId);
    if (projectContext) {
      await projectContext.ctx.cancel();
      logger.debug("[PreviewBundler] Stopped watching", { projectId });
    }
  }

  /**
   * Get the current bundle for a project (without rebuilding)
   */
  getCurrentBundle(projectId: string): string | null {
    return this.contexts.get(projectId)?.currentBundle ?? null;
  }

  /**
   * Get build errors for a project
   */
  getErrors(projectId: string): string[] {
    return this.contexts.get(projectId)?.errors ?? [];
  }

  // HMR Methods

  /**
   * Register a WebSocket client for HMR updates
   */
  registerHmrClient(projectId: string, ws: WebSocket): void {
    let clients = this.hmrClients.get(projectId);
    if (!clients) {
      clients = new Set();
      this.hmrClients.set(projectId, clients);
    }
    clients.add(ws);

    // Send connected message
    this.sendHmrMessage(ws, {
      type: "connected",
      projectId,
      timestamp: Date.now(),
    });

    logger.debug("[PreviewBundler] HMR client registered", {
      projectId,
      clientCount: clients.size,
    });
  }

  /**
   * Unregister a WebSocket client
   */
  unregisterHmrClient(projectId: string, ws: WebSocket): void {
    const clients = this.hmrClients.get(projectId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        this.hmrClients.delete(projectId);
      }
    }
  }

  /**
   * Get HMR runtime code to inject into bundles
   */
  getHmrRuntime(projectId: string): string {
    return createHmrRuntime(projectId, this.hmrPort);
  }

  /**
   * Notify all HMR clients for a project
   */
  private notifyHmrClients(projectId: string, message: HmrMessage): void {
    const clients = this.hmrClients.get(projectId);
    if (!clients || clients.size === 0) return;

    for (const ws of clients) {
      this.sendHmrMessage(ws, message);
    }

    logger.debug("[PreviewBundler] HMR notification sent", {
      projectId,
      type: message.type,
      clientCount: clients.size,
    });
  }

  private sendHmrMessage(ws: WebSocket, message: HmrMessage): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      logger.debug("[PreviewBundler] Failed to send HMR message", { error: String(error) });
    }
  }

  /**
   * Create an esbuild plugin that notifies HMR clients on build end
   */
  private createHmrNotifyPlugin(projectId: string) {
    return {
      name: "veryfront-hmr-notify",
      setup: (build: { onEnd: (callback: (result: BuildResult) => void) => void }) => {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            this.notifyHmrClients(projectId, {
              type: "error",
              projectId,
              error: result.errors.map((e) => e.text).join("\n"),
            });
          } else {
            const updatedModules = this.getUpdatedModules(result);
            this.notifyHmrClients(projectId, {
              type: "update",
              projectId,
              modules: updatedModules,
              timestamp: Date.now(),
            });
          }
        });
      },
    };
  }

  /**
   * Extract updated module paths from build result
   */
  private getUpdatedModules(result: BuildResult): string[] {
    if (!result.metafile?.outputs) return [];

    return Object.keys(result.metafile.outputs);
  }

  // Context Management

  /**
   * Evict the oldest (least recently used) context
   */
  private evictOldestContext(): void {
    let oldest: { projectId: string; lastActivity: number } | null = null;

    for (const [projectId, context] of this.contexts) {
      if (!oldest || context.lastActivity < oldest.lastActivity) {
        oldest = { projectId, lastActivity: context.lastActivity };
      }
    }

    if (oldest) {
      this.disposeContext(oldest.projectId);
      logger.debug("[PreviewBundler] Evicted oldest context", { projectId: oldest.projectId });
    }
  }

  /**
   * Dispose a context and clean up resources
   */
  private async disposeContext(projectId: string): Promise<void> {
    const context = this.contexts.get(projectId);
    if (context) {
      try {
        await context.ctx.dispose();
      } catch (error) {
        logger.debug("[PreviewBundler] Error disposing context", {
          projectId,
          error: String(error),
        });
      }
      this.contexts.delete(projectId);

      // Also clean up HMR clients
      this.hmrClients.delete(projectId);
    }
  }

  /**
   * Start the eviction timer
   */
  private startEvictionTimer(): void {
    this.evictionInterval = setInterval(() => {
      const now = Date.now();
      const toEvict: string[] = [];

      for (const [projectId, context] of this.contexts) {
        if (now - context.lastActivity > this.evictionTimeoutMs) {
          toEvict.push(projectId);
        }
      }

      for (const projectId of toEvict) {
        this.disposeContext(projectId);
        logger.debug("[PreviewBundler] Evicted inactive context", { projectId });
      }
    }, 60_000) as unknown as number; // Check every minute
  }

  /**
   * Stop the eviction timer and dispose all contexts
   */
  async shutdown(): Promise<void> {
    if (this.evictionInterval !== null) {
      clearInterval(this.evictionInterval);
      this.evictionInterval = null;
    }

    for (const projectId of this.contexts.keys()) {
      await this.disposeContext(projectId);
    }

    logger.debug("[PreviewBundler] Shutdown complete");
  }

  /**
   * Get statistics about the bundler
   */
  getStats(): {
    activeContexts: number;
    maxContexts: number;
    hmrClientCount: number;
  } {
    let hmrClientCount = 0;
    for (const clients of this.hmrClients.values()) {
      hmrClientCount += clients.size;
    }

    return {
      activeContexts: this.contexts.size,
      maxContexts: this.maxContexts,
      hmrClientCount,
    };
  }
}

// Singleton instance
let previewBundlerInstance: PreviewBundler | null = null;

/**
 * Get or create the preview bundler singleton
 */
export function getPreviewBundler(config?: PreviewBundlerConfig): PreviewBundler {
  if (!previewBundlerInstance) {
    previewBundlerInstance = new PreviewBundler(config);
  }
  return previewBundlerInstance;
}

/**
 * Reset the preview bundler singleton (for testing)
 */
export async function resetPreviewBundler(): Promise<void> {
  if (previewBundlerInstance) {
    await previewBundlerInstance.shutdown();
    previewBundlerInstance = null;
  }
}
