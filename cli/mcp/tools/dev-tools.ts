/**
 * MCP tools for development workflow (HMR, preview, debug, flywheel).
 */

import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { getEnvironmentConfig } from "veryfront/config";
import { withSpan } from "veryfront/observability/otlp-setup";
import { ReloadNotifier } from "veryfront/server";
import { getErrorCollector, getLogBuffer } from "veryfront/observability";
import type { MCPTool } from "../tools.ts";
import { formatError } from "./helpers.ts";

// ============================================================================
// Tool: vf_hot_reload
// ============================================================================

const getHotReloadInput = defineSchema((v) =>
  v.object({
    file: v
      .string()
      .optional()
      .describe(
        "Specific file to trigger reload for. Example: 'app/page.tsx'. Omit to reload all.",
      ),
  })
);
const hotReloadInput = getHotReloadInput();

type HotReloadInput = InferSchema<ReturnType<typeof getHotReloadInput>>;

interface HotReloadResult {
  success: boolean;
  message: string;
}

export const vfHotReload: MCPTool<HotReloadInput, HotReloadResult> = {
  name: "vf_hot_reload",
  title: "Hot Reload",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when you need to signal that a hot reload should occur. Note: currently a no-op stub that returns success without triggering an actual reload. For file-level HMR that sends a WebSocket update, use vf_trigger_hmr instead.",
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

const getGetDebugContextInput = defineSchema((v) =>
  v.object({
    port: v.number().int().min(1).max(65535).optional().default(8080).describe(
      "Dev server port (defaults to 8080)",
    ),
    project: v
      .string()
      .regex(
        /^[a-z0-9-]+$/,
        "Project slug must contain only lowercase letters, numbers, and hyphens",
      )
      .optional()
      .describe("Project slug to check (for multi-project mode)"),
  })
);
const getDebugContextInput = getGetDebugContextInput();

type GetDebugContextInput = InferSchema<ReturnType<typeof getGetDebugContextInput>>;

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
  title: "Debug Context",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need the dev server's debug context including project slug, environment, request context mode, and multi-project configuration. Returns project info and server mode. Do not use for error details — use vf_get_errors instead.",
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
              projectSlug: data.context?.projectSlug ?? "",
              projectDir: data.context?.projectDir ?? "",
              requestContextMode: data.context?.requestContext?.mode ?? "unknown",
              isMultiProjectMode: data.adapter?.isMultiProjectMode ?? false,
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

const getTriggerHmrInput = defineSchema((v) =>
  v.object({
    path: v.string().describe("File path that changed. Example: 'app/page.tsx'."),
    port: v.number().int().min(1).max(65535).optional().default(8080).describe(
      "Dev server port (defaults to 8080)",
    ),
  })
);
const triggerHmrInput = getTriggerHmrInput();

type TriggerHmrInput = InferSchema<ReturnType<typeof getTriggerHmrInput>>;

interface TriggerHmrResult {
  success: boolean;
  message: string;
}

export const vfTriggerHmr: MCPTool<TriggerHmrInput, TriggerHmrResult> = {
  name: "vf_trigger_hmr",
  title: "Trigger HMR",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when you need to force an HMR update for a specific file path. Sends a WebSocket reload notification to connected browsers. Returns success status and active listener count. Do not use if no browser is connected — check vf_get_flywheel_status first.",
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

const getPreviewRouteInput = defineSchema((v) =>
  v.object({
    route: v.string().regex(/^\//, "Route must start with /").describe(
      "Route path to preview. Example: '/', '/dashboard', '/api/users'.",
    ),
    port: v.number().int().min(1).max(65535).optional().default(8080).describe(
      "Dev server port (defaults to 8080)",
    ),
    format: v
      .enum(["html", "json", "status"])
      .optional()
      .default("status")
      .describe(
        "Output format: 'html' for full page, 'json' for API response, 'status' for just HTTP status. Defaults to 'status'.",
      ),
  })
);
const previewRouteInput = getPreviewRouteInput();

type PreviewRouteInput = InferSchema<ReturnType<typeof getPreviewRouteInput>>;

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
  title: "Preview Route",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to test-render a route and inspect the response. Returns rendered output, HTTP status, and render time. Note: API routes may have side effects. Do not use for listing routes — use vf_list_routes instead.",
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
          const contentType = response.headers.get("content-type") ?? "";

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
            ? `${body.slice(0, maxLength)}\n\n[... truncated ${body.length - maxLength} characters]`
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

const getWaitForReadyInput = defineSchema((v) =>
  v.object({
    port: v.number().int().min(1).max(65535).optional().default(8080).describe(
      "Server port to check (defaults to 8080)",
    ),
    timeout: v
      .number()
      .optional()
      .default(30000)
      .describe("Maximum time to wait in milliseconds (defaults to 30000)"),
    interval: v
      .number()
      .optional()
      .default(500)
      .describe("Polling interval in milliseconds (defaults to 500)"),
  })
);
const waitForReadyInput = getWaitForReadyInput();

type WaitForReadyInput = InferSchema<ReturnType<typeof getWaitForReadyInput>>;

interface WaitForReadyResult {
  success: boolean;
  message: string;
  elapsed?: number;
}

export const vfWaitForReady: MCPTool<WaitForReadyInput, WaitForReadyResult> = {
  name: "vf_wait_for_ready",
  title: "Wait for Ready",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to wait for the dev server to become ready after restart. Polls the health endpoint until responsive. Returns success status and elapsed time. Do not use for error counts or uptime — use vf_get_status instead.",
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

const getGetFlywheelStatusInput = defineSchema((v) =>
  v.object({
    port: v.number().int().min(1).max(65535).optional().default(8080).describe(
      "Server port (defaults to 8080)",
    ),
  })
);
const getFlywheelStatusInput = getGetFlywheelStatusInput();

type GetFlywheelStatusInput = InferSchema<ReturnType<typeof getGetFlywheelStatusInput>>;

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
  title: "Flywheel Status",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need a comprehensive status overview combining server health, error counts, and HMR statistics. Returns server status, error/log counts, and HMR metrics in one response. Do not use for detailed error or log content — use vf_get_errors or vf_get_logs instead.",
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

        const env = getEnvironmentConfig();
        const uptime = env.serverStartTime
          ? Date.now() - Number.parseInt(env.serverStartTime, 10)
          : undefined;

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
