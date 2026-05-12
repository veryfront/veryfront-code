/**
 * Shared JSON-RPC types and utilities for MCP servers
 *
 * @module cli/mcp/jsonrpc
 */

import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";

/**
 * JSON-RPC 2.0 request (validated at runtime for external input)
 */
export const getJSONRPCRequestSchema = defineSchema((v) =>
  v.object({
    jsonrpc: v.literal("2.0"),
    id: v.union([v.string(), v.number()]).optional(),
    method: v.string(),
    params: v.unknown().optional(),
  })
);
export const JSONRPCRequestSchema = getJSONRPCRequestSchema();

export type JSONRPCRequest = InferSchema<ReturnType<typeof getJSONRPCRequestSchema>>;

/**
 * JSON-RPC 2.0 response
 */
export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC standard error codes
 */
export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Error with a JSON-RPC error code attached.
 * Preserves stack traces unlike throwing plain objects.
 */
export class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Create a JSON-RPC parse error response
 */
export function parseError(e: unknown): JSONRPCResponse {
  return {
    jsonrpc: "2.0",
    error: {
      code: JSONRPC_ERRORS.PARSE_ERROR,
      message: "Parse error",
      data: e instanceof Error ? e.message : String(e),
    },
  };
}

/**
 * Create a JSON-RPC success response
 */
export function successResponse(id: string | number | undefined, result: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Create a JSON-RPC error response
 */
export function errorResponse(
  id: string | number | undefined,
  e: unknown,
  code?: number,
): JSONRPCResponse {
  const errorCode = typeof e === "object" && e !== null && "code" in e
    ? (e as { code: unknown }).code
    : undefined;
  const resolvedCode = code ??
    (typeof errorCode === "number" ? errorCode : JSONRPC_ERRORS.INTERNAL_ERROR);
  const message = e instanceof Error
    ? e.message
    : typeof e === "object" && e !== null && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);
  return {
    jsonrpc: "2.0",
    id,
    error: { code: resolvedCode, message },
  };
}

/**
 * Supported MCP protocol versions (newest first).
 * Shared across all CLI MCP servers so the version list is maintained in one place.
 */
export const MCP_SUPPORTED_VERSIONS: [string, ...string[]] = ["2025-11-25", "2024-11-05"];

/**
 * Safely extract a record from unknown params (mirrors src/mcp toParamsRecord).
 */
export function toParamsRecord(params: unknown): Record<string, unknown> {
  if (params && typeof params === "object" && !Array.isArray(params)) {
    return params as Record<string, unknown>;
  }
  return {};
}

/**
 * Negotiate MCP protocol version: echo the client's version if supported,
 * otherwise fall back to the newest supported version.
 */
export function negotiateVersion(params: unknown): string {
  const p = toParamsRecord(params);
  const requested = typeof p.protocolVersion === "string" ? p.protocolVersion : undefined;
  return requested && MCP_SUPPORTED_VERSIONS.includes(requested)
    ? requested
    : MCP_SUPPORTED_VERSIONS[0];
}

/**
 * Build a complete MCP initialize result with negotiated version,
 * capabilities, serverInfo, and instructions.
 */
export function buildInitializeResult(
  params: unknown,
  serverInfo: { name: string; title: string; version: string; description: string },
  instructions: string,
): Record<string, unknown> {
  return {
    protocolVersion: negotiateVersion(params),
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
    },
    serverInfo,
    instructions,
  };
}

/**
 * Validate and extract tools/call params
 */
export const getToolsCallParamsSchema = defineSchema((v) =>
  v.object({
    name: v.string(),
    arguments: v.record(v.string(), v.unknown()).optional(),
  })
);
export const ToolsCallParamsSchema = getToolsCallParamsSchema();

/**
 * Validate and extract prompts/get params
 */
export const getPromptsGetParamsSchema = defineSchema((v) =>
  v.object({
    name: v.string(),
  })
);
export const PromptsGetParamsSchema = getPromptsGetParamsSchema();

/**
 * Validate and extract resources/read params
 */
export const getResourcesReadParamsSchema = defineSchema((v) =>
  v.object({
    uri: v.string(),
  })
);
export const ResourcesReadParamsSchema = getResourcesReadParamsSchema();
