/**************************
 * MCP Tools for Veryfront Dev Server
 **************************/

import { z } from "zod";
import {
  type DevError,
  type ErrorType,
  getErrorCollector,
  getLogBuffer,
  type LogEntry,
  type LogLevel,
} from "veryfront/observability";
import { createFileSystem } from "veryfront/platform";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import type { MCPTool } from "veryfront/mcp";
import { advancedTools } from "./advanced-tools.ts";
import { remoteFileTools } from "./remote-file-tools.ts";
import { issuesMcpTools } from "veryfront/issues";
import { context7Tools } from "./tools/context7-tools.ts";
import { DEFAULT_MCP_PORT } from "#cli/shared/constants";

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
    "Filter by error type. Example: 'compile'. Omit to return all types.",
  ),
  file: z.string().optional().describe(
    "Filter by file path. Example: 'app/page.tsx'. Omit to return errors from all files.",
  ),
  limit: z.number().optional().default(50).describe(
    "Maximum number of errors to return. Defaults to 50.",
  ),
});

type GetErrorsInput = z.infer<typeof getErrorsInput>;

export const vfGetErrors: MCPTool<GetErrorsInput, DevError[]> = {
  name: "vf_get_errors",
  title: "Get Errors",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to check for compilation, runtime, bundle, HMR, or module errors in the dev server. Returns error details including file path, line number, and message. Do not use for server logs — use vf_get_logs instead.",
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
  level: z.enum(["debug", "info", "warn", "error"]).optional().describe(
    "Filter by log level. Example: 'error'. Omit to return all levels.",
  ),
  source: z.string().optional().describe(
    "Filter by log source. Example: 'server', 'hmr', 'transform'. Omit to return all sources.",
  ),
  pattern: z.string().optional().describe(
    "Filter by pattern (case-insensitive substring match). Example: 'timeout'.",
  ),
  limit: z.number().optional().default(100).describe(
    "Maximum number of log entries to return. Defaults to 100.",
  ),
  since: z.number().optional().describe(
    "Only return logs after this Unix timestamp in milliseconds.",
  ),
});

type GetLogsInput = z.infer<typeof getLogsInput>;

export const vfGetLogs: MCPTool<GetLogsInput, LogEntry[]> = {
  name: "vf_get_logs",
  title: "Get Logs",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to inspect server logs to understand runtime behavior or debug request handling. Returns log entries with timestamp, level, source, and message. Do not use for build/compile errors — use vf_get_errors instead.",
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
    "Type of cache to clear. Example: 'modules'. Defaults to 'all'.",
  ),
});

type ClearCacheInput = z.infer<typeof clearCacheInput>;

interface ClearCacheOutput {
  success: boolean;
  cleared: string[];
}

export const vfClearCache: MCPTool<ClearCacheInput, ClearCacheOutput> = {
  name: "vf_clear_cache",
  title: "Clear Cache",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when the dev server shows stale modules or MDX content. Returns the list of cleared cache directories. Do not use to fix code errors — those require code changes.",
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
    title: "Server Status",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    description:
      "Use this when you need a quick summary of the dev server's uptime, error counts, and warning counts. Note: always reports running=true when the MCP server is reachable. Do not use for detailed error info — use vf_get_errors instead.",
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
  file: z.string().optional().describe(
    "Clear errors for a specific file only. Example: 'app/page.tsx'. Omit to clear all files.",
  ),
  type: z.enum(["compile", "runtime", "bundle", "hmr", "module"]).optional().describe(
    "Clear errors of a specific type only. Example: 'compile'. Omit to clear all types.",
  ),
});

type ClearErrorsInput = z.infer<typeof clearErrorsInput>;

interface ClearErrorsOutput {
  cleared: number;
}

export const vfClearErrors: MCPTool<ClearErrorsInput, ClearErrorsOutput> = {
  name: "vf_clear_errors",
  title: "Clear Errors",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when you need to clear accumulated errors from the error collector, optionally filtering by file or type. Returns the number of cleared errors. Do not use for viewing errors — use vf_get_errors instead.",
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
  ...context7Tools,
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
