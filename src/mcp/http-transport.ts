import type { JSONRPCParams, MCPRequestContext } from "./types.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { VeryfrontError } from "#veryfront/security/input-validation/errors.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
  validateContentType,
} from "#veryfront/security/input-validation/limits.ts";
import { SessionManager } from "./session.ts";

const MAX_REQUEST_BODY_SIZE = 1_048_576;
const MAX_RESPONSE_BODY_SIZE = 4 * 1_048_576;
const MAX_METHOD_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 8_192;
const JSON_CONTENT_TYPE = "application/json";
const MCP_SUPPORTED_VERSIONS = new Set(["2025-11-25", "2024-11-05"]);

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: JSONRPCParams;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPHTTPTransportDependencies {
  authEnabled: boolean;
  getCORSHeaders: (requestOrigin?: string | null) => Record<string, string>;
  validateAuth: (request: Request) => Promise<boolean>;
  handleRequest: (
    request: JSONRPCRequest,
    context?: MCPRequestContext,
    sessionId?: string,
  ) => Promise<JSONRPCResponse>;
  extractRequestContext: (request: Request) => MCPRequestContext | undefined;
  isOriginAllowed: (requestOrigin?: string | null) => boolean;
  sessionCapabilities: Map<string, Record<string, unknown>>;
  sessionProtocolVersions: Map<string, string>;
  sessionManager: SessionManager;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseJSONRPCRequest(value: unknown): JSONRPCRequest | undefined {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return undefined;
  if (
    typeof value.method !== "string" || value.method.length === 0 ||
    value.method.length > MAX_METHOD_LENGTH || hasUnsafeControlCharacters(value.method)
  ) {
    return undefined;
  }
  if (
    value.id !== undefined && typeof value.id !== "string" &&
    typeof value.id !== "number"
  ) {
    return undefined;
  }
  if (typeof value.id === "string" && value.id.length > MAX_REQUEST_ID_LENGTH) {
    return undefined;
  }
  if (typeof value.id === "number" && !Number.isSafeInteger(value.id)) {
    return undefined;
  }
  if (
    value.params !== undefined && !isRecord(value.params) &&
    !Array.isArray(value.params)
  ) {
    return undefined;
  }
  return value as unknown as JSONRPCRequest;
}

function serializeResponse(body: unknown): string | undefined {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return undefined;
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BODY_SIZE
  ) {
    return undefined;
  }
  return serialized;
}

function createTextResponse(serialized: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  return new Response(serialized, { ...init, headers });
}

function createJSONResponse(body: unknown, init?: ResponseInit): Response {
  const serialized = serializeResponse(body);
  if (serialized !== undefined) return createTextResponse(serialized, init);
  return createTextResponse(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "Internal error" },
    }),
    { ...init, status: 500 },
  );
}

function createJSONRPCErrorResponse(
  status: number,
  code: number,
  message: string,
  headers?: HeadersInit,
): Response {
  return createJSONResponse(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code, message },
    },
    { status, headers },
  );
}

function isProtocolVersionAccepted(
  protocolVersion: string | null,
  negotiatedVersion?: string,
): boolean {
  return protocolVersion === null ||
    (MCP_SUPPORTED_VERSIONS.has(protocolVersion) &&
      (negotiatedVersion === undefined || protocolVersion === negotiatedVersion));
}

export function createMCPHTTPHandler(
  dependencies: MCPHTTPTransportDependencies,
): (request: Request) => Promise<Response> {
  const {
    authEnabled,
    getCORSHeaders,
    validateAuth,
    handleRequest,
    extractRequestContext,
    isOriginAllowed,
    sessionCapabilities,
    sessionProtocolVersions,
    sessionManager,
  } = dependencies;

  return async (request: Request) => {
    const requestOrigin = request.headers.get("Origin");
    const responseHeaders = getCORSHeaders(requestOrigin);

    if (!isOriginAllowed(requestOrigin)) {
      return createJSONRPCErrorResponse(
        403,
        -32600,
        "Forbidden: Origin not allowed",
        responseHeaders,
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    if (authEnabled) {
      let authorized = false;
      try {
        authorized = (await validateAuth(request)) === true;
      } catch {
        authorized = false;
      }
      if (!authorized) {
        return createJSONRPCErrorResponse(
          401,
          -32001,
          "Unauthorized",
          responseHeaders,
        );
      }
    }

    if (request.method === "DELETE") {
      const sessionId = request.headers.get("MCP-Session-Id");
      if (!sessionId) {
        return createJSONRPCErrorResponse(
          400,
          -32600,
          "Missing MCP-Session-Id header",
          responseHeaders,
        );
      }
      if (!sessionManager.isValid(sessionId)) {
        return createJSONRPCErrorResponse(
          404,
          -32600,
          "Session not found or expired",
          responseHeaders,
        );
      }
      if (
        !isProtocolVersionAccepted(
          request.headers.get("MCP-Protocol-Version"),
          sessionProtocolVersions.get(sessionId),
        )
      ) {
        return createJSONRPCErrorResponse(
          400,
          -32600,
          "Unsupported MCP-Protocol-Version header",
          responseHeaders,
        );
      }
      sessionManager.terminate(sessionId);
      sessionCapabilities.delete(sessionId);
      sessionProtocolVersions.delete(sessionId);
      return new Response(null, { status: 200, headers: responseHeaders });
    }

    if (request.method !== "POST") {
      const headers = new Headers(responseHeaders);
      headers.set("Allow", "POST, DELETE, OPTIONS");
      return createJSONRPCErrorResponse(
        405,
        -32600,
        "Method not allowed",
        headers,
      );
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const declaredLength = Number(contentLength);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_SIZE) {
        return createJSONRPCErrorResponse(
          413,
          -32600,
          "Request body too large",
          responseHeaders,
        );
      }
    }

    try {
      validateContentType(request, JSON_CONTENT_TYPE);
    } catch (error) {
      const message = error instanceof VeryfrontError ? error.message : "Invalid Content-Type";
      return createJSONRPCErrorResponse(400, -32700, message, responseHeaders);
    }

    let parsed: unknown;
    try {
      const bodyText = await readBodyWithLimit(request, MAX_REQUEST_BODY_SIZE);
      parsed = JSON.parse(bodyText);
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) {
        return createJSONRPCErrorResponse(
          413,
          -32600,
          "Request body too large",
          responseHeaders,
        );
      }
      return createJSONRPCErrorResponse(400, -32700, "Parse error", responseHeaders);
    }

    const rpcRequest = parseJSONRPCRequest(parsed);
    if (!rpcRequest) {
      return createJSONRPCErrorResponse(400, -32600, "Invalid Request", responseHeaders);
    }
    if (
      rpcRequest.id === undefined &&
      !rpcRequest.method.startsWith("notifications/")
    ) {
      return createJSONRPCErrorResponse(
        400,
        -32600,
        "MCP requests must include a JSON-RPC id",
        responseHeaders,
      );
    }

    if (rpcRequest.method === "initialize") {
      if (rpcRequest.id === undefined) {
        return createJSONRPCErrorResponse(
          400,
          -32600,
          "Initialize must be a JSON-RPC request",
          responseHeaders,
        );
      }
      const context = extractRequestContext(request);
      const rpcResponse = await handleRequest(rpcRequest, context);
      if (rpcResponse.error) {
        return createJSONResponse(rpcResponse, { headers: responseHeaders });
      }

      const serialized = serializeResponse(rpcResponse);
      if (serialized === undefined) {
        return createJSONResponse(undefined, { headers: responseHeaders });
      }

      let sessionId: string;
      try {
        sessionId = sessionManager.create();
      } catch (error) {
        const status = error instanceof RangeError ? 503 : 500;
        return createJSONRPCErrorResponse(
          status,
          -32603,
          status === 503 ? "Session capacity reached" : "Internal error",
          responseHeaders,
        );
      }

      const params = isRecord(rpcRequest.params) ? rpcRequest.params : {};
      const clientCaps = isRecord(params.capabilities) ? params.capabilities : {};
      const result = isRecord(rpcResponse.result) ? rpcResponse.result : {};
      const negotiatedVersion = typeof result.protocolVersion === "string"
        ? result.protocolVersion
        : "2025-11-25";
      sessionCapabilities.set(sessionId, clientCaps);
      sessionProtocolVersions.set(sessionId, negotiatedVersion);
      const headers = new Headers(responseHeaders);
      headers.set("MCP-Session-Id", sessionId);
      return createTextResponse(serialized, { headers });
    }

    let sessionId: string | undefined;
    if (sessionManager.requiresSessionHeader()) {
      sessionId = request.headers.get("MCP-Session-Id") ?? undefined;
      if (!sessionId) {
        return createJSONRPCErrorResponse(
          400,
          -32600,
          "Missing MCP-Session-Id header",
          responseHeaders,
        );
      }
      if (!sessionManager.isValid(sessionId)) {
        return createJSONRPCErrorResponse(
          404,
          -32600,
          "Session not found or expired",
          responseHeaders,
        );
      }
    }

    const protocolVersion = request.headers.get("MCP-Protocol-Version");
    const negotiatedVersion = sessionId ? sessionProtocolVersions.get(sessionId) : undefined;
    if (!isProtocolVersionAccepted(protocolVersion, negotiatedVersion)) {
      return createJSONRPCErrorResponse(
        400,
        -32600,
        "Unsupported MCP-Protocol-Version header",
        responseHeaders,
      );
    }

    const context = extractRequestContext(request);
    if (rpcRequest.id === undefined) {
      await handleRequest(rpcRequest, context, sessionId);
      return new Response(null, { status: 202, headers: responseHeaders });
    }

    const rpcResponse = await handleRequest(rpcRequest, context, sessionId);
    return createJSONResponse(rpcResponse, { headers: responseHeaders });
  };
}
