/**************************
 * MCP Tools for Veryfront Dev Server
 **************************/

import { z } from "zod";
import {
  type DevError,
  type ErrorType,
  getErrorCollector,
} from "#veryfront/observability/error-collector.ts";
import { getLogBuffer, type LogEntry, type LogLevel } from "#veryfront/observability/log-buffer.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import type { MCPTool } from "#veryfront/mcp/types.ts";
import { advancedTools } from "./advanced-tools.ts";
import { remoteFileTools } from "./remote-file-tools.ts";
import { issuesMcpTools } from "../../issues/mcp.ts";
import { DEFAULT_MCP_PORT } from "../shared/constants.ts";

export type { MCPTool };

const CACHE_DIRS: Record<string, string[]> = {
  all: [".cache/veryfront-modules", ".cache/veryfront-mdx-esm"],
  modules: [".cache/veryfront-modules"],
  mdx: [".cache/veryfront-mdx-esm"],
};

let serverStartTime = Date.now();

export function setServerStartTime(time: number): void {
  serverStartTime = time;
}

const getErrorsInput = z.object({
  type: z.enum(["compile", "runtime", "bundle", "hmr", "module"]).optional().describe(
    "Filter by error type",
  ),
  file: z.string().optional().describe("Filter by file path"),
  limit: z.number().optional().default(50).describe("Maximum number of errors to return"),
});

type GetErrorsInput = z.infer<typeof getErrorsInput>;

export const vfGetErrors: MCPTool<GetErrorsInput, DevError[]> = {
  name: "vf_get_errors",
  description:
    "Get compilation, runtime, and build errors from the dev server. Use this to debug issues with your code.",
  inputSchema: getErrorsInput,
  execute: async (input) => {
    const errors = getErrorCollector().getAll({
      type: input.type as ErrorType | undefined,
      file: input.file,
    });

    if (input.limit && errors.length > input.limit) return errors.slice(-input.limit);
    return errors;
  },
};

const getLogsInput = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).optional().describe("Filter by log level"),
  source: z.string().optional().describe(
    "Filter by log source (e.g., 'server', 'hmr', 'transform')",
  ),
  pattern: z.string().optional().describe("Filter by pattern (case-insensitive substring match)"),
  limit: z.number().optional().default(100).describe("Maximum number of log entries to return"),
  since: z.number().optional().describe("Only return logs after this timestamp"),
});

type GetLogsInput = z.infer<typeof getLogsInput>;

export const vfGetLogs: MCPTool<GetLogsInput, LogEntry[]> = {
  name: "vf_get_logs",
  description:
    "Get recent server logs. Use this to understand what the server is doing and debug runtime issues.",
  inputSchema: getLogsInput,
  execute: async (input) => {
    return getLogBuffer().query({
      level: input.level as LogLevel | undefined,
      source: input.source,
      pattern: input.pattern,
      limit: input.limit,
      since: input.since,
    });
  },
};

const clearCacheInput = z.object({
  type: z.enum(["all", "modules", "mdx"]).optional().default("all").describe(
    "Type of cache to clear",
  ),
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
    const cacheDirs = CACHE_DIRS[input.type] ?? [];

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
  env: EnvironmentConfig = getEnvironmentConfig(),
): MCPTool<GetStatusInput, ServerStatus> {
  return {
    name: "vf_get_status",
    description: "Get the current status of the dev server including error counts and uptime.",
    inputSchema: getStatusInput,
    execute: async () => {
      const errors = getErrorCollector();
      const logs = getLogBuffer();
      const counts = errors.countByType();
      const port = env.port ?? DEFAULT_MCP_PORT;

      return {
        running: true,
        url: `http://veryfront.me:${port}`,
        port,
        errorCount: counts.compile + counts.runtime + counts.bundle,
        warningCount: logs.query({ level: "warn" }).length,
        logCount: logs.count,
        uptime: Date.now() - serverStartTime,
      };
    },
  };
}

export const vfGetStatus = createVfGetStatus();

const clearErrorsInput = z.object({
  file: z.string().optional().describe("Clear errors for a specific file only"),
  type: z.enum(["compile", "runtime", "bundle", "hmr", "module"]).optional().describe(
    "Clear errors of a specific type only",
  ),
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

    if (input.file) return { cleared: collector.clearFile(input.file) };
    if (input.type) return { cleared: collector.clearType(input.type as ErrorType) };

    const cleared = collector.count;
    collector.clear();
    return { cleared };
  },
};

export const allTools: MCPTool[] = [
  ...advancedTools,
  ...remoteFileTools,
  ...issuesMcpTools,
  vfGetErrors,
  vfGetLogs,
  vfClearCache,
  vfGetStatus,
  vfClearErrors,
];

export function getTool(name: string): MCPTool | undefined {
  return allTools.find((tool) => tool.name === name);
}

export function listTools(): Array<{ name: string; description: string }> {
  return allTools.map(({ name, description }) => ({ name, description }));
}
