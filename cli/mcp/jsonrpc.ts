/**
 * Shared JSON-RPC types and utilities for MCP servers
 *
 * @module cli/mcp/jsonrpc
 */

import { z } from "zod";

/**
 * JSON-RPC 2.0 request (validated at runtime for external input)
 */
export const JSONRPCRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

export type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;

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
  code = JSONRPC_ERRORS.INTERNAL_ERROR,
): JSONRPCResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message: e instanceof Error ? e.message : String(e),
    },
  };
}

/**
 * Validate and extract tools/call params
 */
export const ToolsCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional(),
});

/**
 * Validate and extract prompts/get params
 */
export const PromptsGetParamsSchema = z.object({
  name: z.string(),
});

/**
 * Validate and extract resources/read params
 */
export const ResourcesReadParamsSchema = z.object({
  uri: z.string(),
});
