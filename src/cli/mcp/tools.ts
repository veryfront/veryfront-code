/**
 * MCP Tools for Veryfront Dev Server
 *
 * A comprehensive toolkit for coding agents to understand, navigate, and modify
 * Veryfront projects. Tools are organized into categories:
 *
 * - Project Understanding: vf_get_project_context, vf_list_routes, vf_get_conventions
 * - Local File Operations: vf_read_file, vf_write_file, vf_edit_file, vf_search_files
 * - Remote File Operations: vf_remote_list_files, vf_remote_get_file, vf_remote_update_file, etc.
 * - Code Generation: vf_scaffold
 * - Dev Server: vf_get_errors, vf_get_logs, vf_clear_cache, vf_get_status
 */

import { z } from "zod";
import { type DevError, type ErrorType, getErrorCollector } from "./error-collector.ts";
import { getLogBuffer, type LogEntry, type LogLevel } from "./log-buffer.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { advancedTools } from "./advanced-tools.ts";
import { remoteFileTools } from "./remote-file-tools.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

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
// Constants
// ============================================================================

/** Cache directories that can be cleared */
const CACHE_DIRS: Record<string, string[]> = {
  all: [".cache/veryfront-modules", ".cache/veryfront-mdx-esm"],
  modules: [".cache/veryfront-modules"],
  mdx: [".cache/veryfront-mdx-esm"],
};

/** Default server port */
const DEFAULT_PORT = 8080;

// ============================================================================
// State
// ============================================================================

let serverStartTime = Date.now();

export function setServerStartTime(time: number): void {
  serverStartTime = time;
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
  execute: (input) => {
    const collector = getErrorCollector();
    const errors = collector.getAll({
      type: input.type as ErrorType | undefined,
      file: input.file,
    });

    if (input.limit && errors.length > input.limit) {
      return Promise.resolve(errors.slice(-input.limit));
    }

    return Promise.resolve(errors);
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
  execute: (input) => {
    const buffer = getLogBuffer();
    return Promise.resolve(buffer.query({
      level: input.level as LogLevel | undefined,
      source: input.source,
      pattern: input.pattern,
      limit: input.limit,
      since: input.since,
    }));
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
    const fs = createFileSystem();
    const cleared: string[] = [];
    const cacheDirs = CACHE_DIRS[input.type] || [];

    for (const dir of cacheDirs) {
      try {
        await fs.remove(dir, { recursive: true });
        cleared.push(dir);
      } catch {
        // Directory doesn't exist
      }
    }

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

export function createVfGetStatus(
  env: RuntimeEnv = getRuntimeEnv(),
): MCPTool<GetStatusInput, ServerStatus> {
  return {
    name: "vf_get_status",
    description: "Get the current status of the dev server including error counts and uptime.",
    inputSchema: getStatusInput,
    execute: () => {
      const errors = getErrorCollector();
      const logs = getLogBuffer();
      const counts = errors.countByType();
      const port = env.port || DEFAULT_PORT;

      return Promise.resolve({
        running: true,
        url: `http://lvh.me:${port}`,
        port,
        errorCount: counts.compile + counts.runtime + counts.bundle,
        warningCount: logs.query({ level: "warn" }).length,
        logCount: logs.count,
        uptime: Date.now() - serverStartTime,
      });
    },
  };
}

export const vfGetStatus = createVfGetStatus();

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
  execute: (input) => {
    const collector = getErrorCollector();

    if (input.file) {
      return Promise.resolve({ cleared: collector.clearFile(input.file) });
    }

    if (input.type) {
      return Promise.resolve({ cleared: collector.clearType(input.type as ErrorType) });
    }

    const count = collector.count;
    collector.clear();
    return Promise.resolve({ cleared: count });
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

export const allTools: MCPTool[] = [
  // Advanced tools for coding agents (most used)
  ...advancedTools,
  // Remote file tools for editing remote project files via REST API
  ...remoteFileTools,
  // Dev server tools
  vfGetErrors,
  vfGetLogs,
  vfClearCache,
  vfGetStatus,
  vfClearErrors,
];

/**
 * Get a tool by name
 */
export function getTool(name: string): MCPTool | undefined {
  return allTools.find((tool) => tool.name === name);
}

/**
 * List all available tools with their descriptions
 */
export function listTools(): Array<{ name: string; description: string }> {
  return allTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}
