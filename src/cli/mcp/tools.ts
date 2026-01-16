/**
 * MCP Tools for Dev Server
 *
 * Exposes dev server functionality to coding agents via MCP.
 * Tools: vf_get_errors, vf_get_logs, vf_list_routes, vf_clear_cache, vf_restart
 */

import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { type DevError, type ErrorType, getErrorCollector } from "./error-collector.ts";
import { getLogBuffer, type LogEntry, type LogLevel } from "./log-buffer.ts";

// ============================================================================
// Types
// ============================================================================

// deno-lint-ignore no-explicit-any
export interface MCPTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  // deno-lint-ignore no-explicit-any
  inputSchema: z.ZodType<any, any, any>;
  execute: (input: TInput) => Promise<TOutput>;
}

// ============================================================================
// Tool: vf_get_errors
// ============================================================================

const getErrorsInput = z.object({
  type: z.enum(["compile", "runtime", "bundle", "hmr", "module"]).optional()
    .describe("Filter by error type"),
  file: z.string().optional()
    .describe("Filter by file path"),
  limit: z.number().optional().default(50)
    .describe("Maximum number of errors to return"),
});

type GetErrorsInput = z.infer<typeof getErrorsInput>;

export const vfGetErrors: MCPTool<GetErrorsInput, DevError[]> = {
  name: "vf_get_errors",
  description:
    "Get compilation, runtime, and build errors from the dev server. Use this to debug issues with your code.",
  inputSchema: getErrorsInput,
  execute: async (input) => {
    const collector = getErrorCollector();
    let errors = collector.getAll({
      type: input.type as ErrorType | undefined,
      file: input.file,
    });

    if (input.limit && errors.length > input.limit) {
      errors = errors.slice(-input.limit);
    }

    return errors;
  },
};

// ============================================================================
// Tool: vf_get_logs
// ============================================================================

const getLogsInput = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).optional()
    .describe("Filter by log level"),
  source: z.string().optional()
    .describe("Filter by log source (e.g., 'server', 'hmr', 'transform')"),
  pattern: z.string().optional()
    .describe("Filter by pattern (case-insensitive substring match)"),
  limit: z.number().optional().default(100)
    .describe("Maximum number of log entries to return"),
  since: z.number().optional()
    .describe("Only return logs after this timestamp"),
});

type GetLogsInput = z.infer<typeof getLogsInput>;

export const vfGetLogs: MCPTool<GetLogsInput, LogEntry[]> = {
  name: "vf_get_logs",
  description:
    "Get recent server logs. Use this to understand what the server is doing and debug runtime issues.",
  inputSchema: getLogsInput,
  execute: async (input) => {
    const buffer = getLogBuffer();
    return buffer.query({
      level: input.level as LogLevel | undefined,
      source: input.source,
      pattern: input.pattern,
      limit: input.limit,
      since: input.since,
    });
  },
};

// ============================================================================
// Tool: vf_clear_cache
// ============================================================================

const clearCacheInput = z.object({
  type: z.enum(["all", "modules", "mdx"]).optional().default("all")
    .describe("Type of cache to clear"),
});

type ClearCacheInput = z.infer<typeof clearCacheInput>;

interface ClearCacheOutput {
  success: boolean;
  cleared: string[];
}

export const vfClearCache: MCPTool<ClearCacheInput, ClearCacheOutput> = {
  name: "vf_clear_cache",
  description:
    "Clear module and build caches. Use this when changes aren't being reflected or to force a rebuild.",
  inputSchema: clearCacheInput,
  execute: async (input) => {
    const cleared: string[] = [];
    const cacheDirs: string[] = [];

    if (input.type === "all" || input.type === "modules") {
      cacheDirs.push(".cache/veryfront-modules");
    }
    if (input.type === "all" || input.type === "mdx") {
      cacheDirs.push(".cache/veryfront-mdx-esm");
    }

    for (const dir of cacheDirs) {
      try {
        await Deno.remove(dir, { recursive: true });
        cleared.push(dir);
      } catch {
        // Directory doesn't exist, that's fine
      }
    }

    // Clear error collector since errors may be stale
    getErrorCollector().clear();

    return { success: true, cleared };
  },
};

// ============================================================================
// Tool: vf_get_status
// ============================================================================

const getStatusInput = z.object({});

type GetStatusInput = z.infer<typeof getStatusInput>;

interface ServerStatus {
  running: boolean;
  url: string;
  port: number;
  errorCount: number;
  warningCount: number;
  logCount: number;
  uptime: number;
}

// Track server start time
let serverStartTime = Date.now();

export function setServerStartTime(time: number): void {
  serverStartTime = time;
}

export const vfGetStatus: MCPTool<GetStatusInput, ServerStatus> = {
  name: "vf_get_status",
  description: "Get the current status of the dev server including error counts and uptime.",
  inputSchema: getStatusInput,
  execute: async () => {
    const errors = getErrorCollector();
    const logs = getLogBuffer();
    const counts = errors.countByType();

    return {
      running: true,
      url: `http://lvh.me:${Deno.env.get("PORT") || 8080}`,
      port: parseInt(Deno.env.get("PORT") || "8080", 10),
      errorCount: counts.compile + counts.runtime + counts.bundle,
      warningCount: logs.query({ level: "warn" }).length,
      logCount: logs.count,
      uptime: Date.now() - serverStartTime,
    };
  },
};

// ============================================================================
// Tool: vf_clear_errors
// ============================================================================

const clearErrorsInput = z.object({
  file: z.string().optional()
    .describe("Clear errors for a specific file only"),
  type: z.enum(["compile", "runtime", "bundle", "hmr", "module"]).optional()
    .describe("Clear errors of a specific type only"),
});

type ClearErrorsInput = z.infer<typeof clearErrorsInput>;

interface ClearErrorsOutput {
  cleared: number;
}

export const vfClearErrors: MCPTool<ClearErrorsInput, ClearErrorsOutput> = {
  name: "vf_clear_errors",
  description: "Clear errors from the error collector. Useful after fixing issues.",
  inputSchema: clearErrorsInput,
  execute: async (input) => {
    const collector = getErrorCollector();

    if (input.file) {
      const cleared = collector.clearFile(input.file);
      return { cleared };
    }

    if (input.type) {
      const cleared = collector.clearType(input.type as ErrorType);
      return { cleared };
    }

    const count = collector.count;
    collector.clear();
    return { cleared: count };
  },
};

// ============================================================================
// All Tools
// ============================================================================

export const allTools: MCPTool[] = [
  vfGetErrors,
  vfGetLogs,
  vfClearCache,
  vfGetStatus,
  vfClearErrors,
];

/**
 * Get tool by name
 */
export function getTool(name: string): MCPTool | undefined {
  return allTools.find((t) => t.name === name);
}

/**
 * List all available tools
 */
export function listTools(): Array<{ name: string; description: string }> {
  return allTools.map((t) => ({
    name: t.name,
    description: t.description,
  }));
}
