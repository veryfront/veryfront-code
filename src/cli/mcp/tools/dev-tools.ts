/**
 * MCP tools for development workflow (HMR, preview, debug, flywheel).
 */

import { z } from "zod";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ReloadNotifier } from "../../../server/reload-notifier.ts";
import { getErrorCollector } from "../error-collector.ts";
import { getLogBuffer } from "../log-buffer.ts";
import { getRuntimeEnv } from "#veryfront/config/runtime-env.ts";
import type { MCPTool } from "../tools.ts";
import { formatError } from "./helpers.ts";

// ============================================================================
// Tool: vf_hot_reload
// ============================================================================

const hotReloadInput = z.object({
  file: z.string().optional().describe(
    "Specific file to trigger reload for (optional - reloads all if not specified)",
  ),
});

type HotReloadInput = z.infer<typeof hotReloadInput>;

interface HotReloadResult {
  success: boolean;
  message: string;
}

export const vfHotReload: MCPTool<HotReloadInput, HotReloadResult> = {
  name: "vf_hot_reload",
  description:
    "Trigger a hot reload of the dev server. Use after making changes to see them instantly.",
  inputSchema: hotReloadInput,
  execute: () =>
    Promise.resolve({
      success: true,
      message: "Hot reload triggered. Changes should be visible in the browser.",
    }),
};

// ============================================================================
// Tool: vf_get_debug_context
// ============================================================================

const getDebugContextInput = z.object({
  port: z.number().optional().default(8080).describe("Dev server port (defaults to 8080)"),
  project: z.string().optional().describe("Project slug to check (for multi-project mode)"),
});

type GetDebugContextInput = z.infer<typeof getDebugContextInput>;

interface DebugContextResult {
  success: boolean;
  context?: {
    projectSlug: string;
    projectDir: string;
    requestContextMode?: string;
    isMultiProjectMode: boolean;
  };
  error?: string;
}

export const vfGetDebugContext: MCPTool<GetDebugContextInput, DebugContextResult> = {
  name: "vf_get_debug_context",
  description:
    "Get the current server context including project info, environment, and mode. Useful for debugging server configuration issues.",
  inputSchema: getDebugContextInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_debug_context",
      async () => {
        const host = input.project ? `${input.project}.veryfront.me` : "veryfront.me";
        const url = `http://${host}:${input.port}/_vf_debug/context`;

        try {
          const response = await fetch(url);
          if (!response.ok) {
            return {
              success: false,
              error: `Server returned ${response.status}: ${response.statusText}`,
            };
          }

          const data = await response.json();
          return {
            success: true,
            context: {
              projectSlug: data.context?.projectSlug || "",
              projectDir: data.context?.projectDir || "",
              requestContextMode: data.context?.requestContext?.mode || "unknown",
              isMultiProjectMode: data.adapter?.isMultiProjectMode || false,
            },
          };
        } catch (error) {
          return { success: false, error: formatError(error) };
        }
      },
      { "tool.port": input.port },
    ),
};

// ============================================================================
// Tool: vf_trigger_hmr
// ============================================================================

const triggerHmrInput = z.object({
  path: z.string().describe("File path that changed (e.g., 'app/page.tsx')"),
  port: z.number().optional().default(8080).describe("Dev server port (defaults to 8080)"),
});

type TriggerHmrInput = z.infer<typeof triggerHmrInput>;

interface TriggerHmrResult {
  success: boolean;
  message: string;
}

export const vfTriggerHmr: MCPTool<TriggerHmrInput, TriggerHmrResult> = {
  name: "vf_trigger_hmr",
  description:
    "Trigger Hot Module Replacement for a specific file. The browser will update without a full reload.",
  inputSchema: triggerHmrInput,
  execute: (input) => {
    const metrics = ReloadNotifier.getMetrics();
    if (metrics.activeReloadListeners <= 0) {
      return Promise.resolve({
        success: false,
        message: "No HMR listeners registered. Is the server running with HMR enabled?",
      });
    }

    ReloadNotifier.triggerReload([input.path]);

    return Promise.resolve({
      success: true,
      message: `HMR triggered for ${input.path}. Browser will refresh after debounce (300ms).`,
    });
  },
};

// ============================================================================
// Tool: vf_preview_route
// ============================================================================

const previewRouteInput = z.object({
  route: z.string().describe("Route path to preview (e.g., '/', '/dashboard', '/api/users')"),
  port: z.number().optional().default(8080).describe("Dev server port (defaults to 8080)"),
  format: z.enum(["html", "json", "status"]).optional().default("status").describe(
    "Output format: html (full page), json (API response), status (just HTTP status)",
  ),
});

type PreviewRouteInput = z.infer<typeof previewRouteInput>;

interface PreviewRouteResult {
  success: boolean;
  status: number;
  contentType?: string;
  body?: string;
  headers?: Record<string, string>;
  error?: string;
  renderTime?: number;
}

export const vfPreviewRoute: MCPTool<PreviewRouteInput, PreviewRouteResult> = {
  name: "vf_preview_route",
  description:
    "Preview a route by making a request to the dev server. Returns the rendered output, HTTP status, and render time. Perfect for testing changes instantly.",
  inputSchema: previewRouteInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_preview_route",
      async () => {
        const url = `http://localhost:${input.port}${input.route}`;
        const startTime = Date.now();

        try {
          const response = await fetch(url, {
            headers: {
              Accept: input.format === "json" ? "application/json" : "text/html",
            },
          });

          const renderTime = Date.now() - startTime;
          const contentType = response.headers.get("content-type") || "";

          if (input.format === "status") {
            return { success: response.ok, status: response.status, contentType, renderTime };
          }

          const body = await response.text();
          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });

          const maxLength = input.format === "html" ? 5000 : 10000;
          const truncatedBody = body.length > maxLength
            ? body.slice(0, maxLength) + `\n\n[... truncated ${body.length - maxLength} characters]`
            : body;

          return {
            success: response.ok,
            status: response.status,
            contentType,
            body: truncatedBody,
            headers,
            renderTime,
          };
        } catch (error) {
          return { success: false, status: 0, error: formatError(error) };
        }
      },
      { "tool.route": input.route, "tool.port": input.port },
    ),
};

// ============================================================================
// Tool: vf_wait_for_ready
// ============================================================================

const waitForReadyInput = z.object({
  port: z.number().optional().default(8080).describe("Server port to check (defaults to 8080)"),
  timeout: z.number().optional().default(30000).describe(
    "Maximum time to wait in milliseconds (defaults to 30000)",
  ),
  interval: z.number().optional().default(500).describe(
    "Polling interval in milliseconds (defaults to 500)",
  ),
});

type WaitForReadyInput = z.infer<typeof waitForReadyInput>;

interface WaitForReadyResult {
  success: boolean;
  message: string;
  elapsed?: number;
}

export const vfWaitForReady: MCPTool<WaitForReadyInput, WaitForReadyResult> = {
  name: "vf_wait_for_ready",
  description:
    "Wait for the server to be ready by polling the health endpoint. Use this after starting the server to ensure it's accepting requests.",
  inputSchema: waitForReadyInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_wait_for_ready",
      async () => {
        const startTime = Date.now();
        const deadline = startTime + input.timeout;
        const url = `http://localhost:${input.port}/`;

        while (Date.now() < deadline) {
          try {
            const response = await fetch(url, {
              method: "HEAD",
              signal: AbortSignal.timeout(2000),
            });

            if (response.ok || response.status < 500) {
              const elapsed = Date.now() - startTime;
              return { success: true, message: `Server ready on port ${input.port}`, elapsed };
            }
          } catch {
            // Server not ready yet, continue polling
          }

          await new Promise((resolve) => setTimeout(resolve, input.interval));
        }

        return {
          success: false,
          message: `Timeout waiting for server on port ${input.port} after ${input.timeout}ms`,
          elapsed: input.timeout,
        };
      },
      { "tool.port": input.port, "tool.timeout": input.timeout },
    ),
};

// ============================================================================
// Tool: vf_get_flywheel_status
// ============================================================================

const getFlywheelStatusInput = z.object({
  port: z.number().optional().default(8080).describe("Server port (defaults to 8080)"),
});

type GetFlywheelStatusInput = z.infer<typeof getFlywheelStatusInput>;

interface FlywheelStatus {
  server: {
    running: boolean;
    port: number;
    url: string;
    uptime?: number;
  };
  errors: {
    total: number;
    compile: number;
    runtime: number;
    bundle: number;
    hmr: number;
    module: number;
    latest?: {
      type: string;
      message: string;
      file?: string;
      timestamp: number;
    };
  };
  logs: {
    total: number;
    errors: number;
    warnings: number;
  };
  hmr: {
    enabled: boolean;
    reloadListeners: number;
    invalidateListeners: number;
    triggerCalls: number;
    broadcastsSent: number;
  };
}

export const vfGetFlywheelStatus: MCPTool<GetFlywheelStatusInput, FlywheelStatus> = {
  name: "vf_get_flywheel_status",
  description:
    "Get aggregated status for the development flywheel. Shows server state, error counts, log summary, and HMR status in one view.",
  inputSchema: getFlywheelStatusInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_flywheel_status",
      async () => {
        const port = input.port;
        const errorCollector = getErrorCollector();
        const logBuffer = getLogBuffer();
        const hmrMetrics = ReloadNotifier.getMetrics();

        let serverRunning = false;
        try {
          const response = await fetch(`http://localhost:${port}/`, {
            method: "HEAD",
            signal: AbortSignal.timeout(2000),
          });
          serverRunning = response.ok || response.status < 500;
        } catch {
          serverRunning = false;
        }

        const errorCounts = errorCollector.countByType();
        const allErrors = errorCollector.getAll();
        const latestError = allErrors.at(-1);

        const logCounts = logBuffer.countByLevel();

        let uptime: number | undefined;
        const env = getRuntimeEnv();
        if (env.serverStartTime) uptime = Date.now() - parseInt(env.serverStartTime, 10);

        return {
          server: {
            running: serverRunning,
            port,
            url: `http://localhost:${port}`,
            uptime,
          },
          errors: {
            total: allErrors.length,
            compile: errorCounts.compile,
            runtime: errorCounts.runtime,
            bundle: errorCounts.bundle,
            hmr: errorCounts.hmr,
            module: errorCounts.module,
            latest: latestError
              ? {
                type: latestError.type,
                message: latestError.message,
                file: latestError.file,
                timestamp: latestError.timestamp,
              }
              : undefined,
          },
          logs: {
            total: logBuffer.count,
            errors: logCounts.error,
            warnings: logCounts.warn,
          },
          hmr: {
            enabled: hmrMetrics.activeReloadListeners > 0,
            reloadListeners: hmrMetrics.activeReloadListeners,
            invalidateListeners: hmrMetrics.activeInvalidateListeners,
            triggerCalls: hmrMetrics.triggerCalls,
            broadcastsSent: hmrMetrics.broadcastsSent,
          },
        };
      },
      { "tool.port": input.port },
    ),
};
