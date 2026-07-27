import type { ToolExecutionContext } from "#veryfront/tool";
import { VeryfrontError } from "#veryfront/security/input-validation/errors.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
  validateContentType,
} from "#veryfront/security/input-validation/limits.ts";
import { isSupportedMCPProtocolVersion, type MCPSupportedProtocolVersion } from "./protocol.ts";
import { SessionManager } from "./session.ts";

const MAX_REQUEST_BODY_SIZE = 1_048_576; // 1 MB
const JSON_CONTENT_TYPE = "application/json";

type JSONRPCParams = Record<string, unknown> | unknown[];

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
  getAuthBinding: (request: Request) => Promise<string | undefined>;
  handleRequest: (
    request: JSONRPCRequest,
    context?: ToolExecutionContext,
    sessionId?: string,
  ) => Promise<JSONRPCResponse>;
  extractRequestContext: (request: Request) => ToolExecutionContext | undefined;
  isOriginAllowed: (requestOrigin?: string | null) => boolean;
  sessionCapabilities: Map<string, Record<string, unknown>>;
  sessionAuthBindings: Map<string, string>;
  sessionProtocolVersions: Map<string, MCPSupportedProtocolVersion>;
  sessionManager: SessionManager;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function secureHeaders(headers?: HeadersInit): Headers {
  const secured = new Headers(headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    secured.set(name, value);
  }
  return secured;
}

function createJSONResponse(body: unknown, init?: ResponseInit): Response {
  const headers = secureHeaders(init?.headers);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(body), { ...init, headers });
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

function createEmptyResponse(status: number, headers?: HeadersInit): Response {
  return new Response(null, { status, headers: secureHeaders(headers) });
}

function createTextResponse(
  body: string,
  status: number,
  headers?: HeadersInit,
): Response {
  return new Response(body, { status, headers: secureHeaders(headers) });
}

type ParsedJSONRPCMessage =
  | { kind: "request"; request: JSONRPCRequest }
  | { kind: "response" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJSONRPCId(value: unknown): value is string | number {
  return typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value));
}

function parseJSONRPCMessage(value: unknown): ParsedJSONRPCMessage | undefined {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return undefined;

  if ("method" in value) {
    if (typeof value.method !== "string" || value.method.length === 0) {
      return undefined;
    }
    if ("id" in value && !isJSONRPCId(value.id)) return undefined;
    if (
      "params" in value &&
      (!isRecord(value.params) && !Array.isArray(value.params))
    ) {
      return undefined;
    }
    return {
      kind: "request",
      request: value as unknown as JSONRPCRequest,
    };
  }

  const hasResult = "result" in value;
  const hasError = "error" in value;
  if (
    !("id" in value) ||
    (value.id !== null && !isJSONRPCId(value.id)) ||
    hasResult === hasError
  ) {
    return undefined;
  }
  if (hasError && !isRecord(value.error)) return undefined;
  return { kind: "response" };
}

export function createMCPHTTPHandler(
  dependencies: MCPHTTPTransportDependencies,
): (request: Request) => Promise<Response> {
  const {
    authEnabled,
    getCORSHeaders,
    validateAuth,
    getAuthBinding,
    handleRequest,
    extractRequestContext,
    isOriginAllowed,
    sessionCapabilities,
    sessionAuthBindings,
    sessionProtocolVersions,
    sessionManager,
  } = dependencies;

  return async (request: Request) => {
    const requestOrigin = request.headers.get("Origin");
    const responseHeaders = getCORSHeaders(requestOrigin);

    if (!isOriginAllowed(requestOrigin)) {
      return createJSONRPCErrorResponse(403, -32600, "Forbidden: Origin not allowed");
    }

    if (request.method === "OPTIONS") {
      return createEmptyResponse(204, responseHeaders);
    }

    let authBinding: string | undefined;
    if (authEnabled) {
      let authorized = false;
      try {
        authorized = await validateAuth(request) === true;
      } catch {
        // Authentication infrastructure failures are indistinguishable from
        // invalid credentials at this boundary and must fail closed.
      }
      if (!authorized) {
        return createTextResponse("Unauthorized", 401, responseHeaders);
      }
      try {
        authBinding = await getAuthBinding(request);
      } catch {
        // Treat an unavailable binding exactly like an unavailable validator.
      }
      if (authBinding === undefined) {
        return createTextResponse("Unauthorized", 401, responseHeaders);
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
      if (!sessionManager.isActive(sessionId)) {
        return createJSONRPCErrorResponse(
          404,
          -32600,
          "Session not found or expired",
          responseHeaders,
        );
      }
      if (
        authEnabled &&
        sessionAuthBindings.get(sessionId) !== authBinding
      ) {
        return createJSONRPCErrorResponse(
          404,
          -32600,
          "Session not found or expired",
          responseHeaders,
        );
      }
      const protocolError = validateProtocolVersionHeader(
        request,
        sessionId,
        sessionProtocolVersions,
      );
      if (protocolError) {
        return createJSONRPCErrorResponse(
          400,
          -32600,
          protocolError,
          responseHeaders,
        );
      }

      sessionManager.terminate(sessionId);
      sessionCapabilities.delete(sessionId);
      sessionAuthBindings.delete(sessionId);
      sessionProtocolVersions.delete(sessionId);
      return createEmptyResponse(200, responseHeaders);
    }

    if (request.method !== "POST") {
      return createTextResponse("Method Not Allowed", 405, responseHeaders);
    }

    // Fast-path rejection when the client advertises an oversized body. This is
    // advisory only (chunked/omitted content-length bypasses it), so the
    // streaming read below enforces the true cap.
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_SIZE) {
      return createJSONRPCErrorResponse(
        413,
        -32600,
        "Request body too large",
        responseHeaders,
      );
    }

    try {
      validateContentType(request, JSON_CONTENT_TYPE);
    } catch (error) {
      const message = error instanceof VeryfrontError ? error.message : "Invalid Content-Type";
      return createJSONRPCErrorResponse(400, -32700, message, responseHeaders);
    }

    let parsedBody: unknown;
    try {
      // readBodyWithLimit streams the body and aborts once the byte cap is
      // exceeded, so an oversized (or chunked) body is rejected without being
      // fully buffered first.
      const bodyText = await readBodyWithLimit(request, MAX_REQUEST_BODY_SIZE);
      parsedBody = JSON.parse(bodyText);
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) {
        return createJSONRPCErrorResponse(
          413,
          -32600,
          "Request body too large",
          responseHeaders,
        );
      }
      return createJSONRPCErrorResponse(
        400,
        -32700,
        "Parse error",
        responseHeaders,
      );
    }

    const parsedMessage = parseJSONRPCMessage(parsedBody);
    if (!parsedMessage) {
      return createJSONRPCErrorResponse(
        400,
        -32600,
        "Invalid JSON-RPC message",
        responseHeaders,
      );
    }

    if (
      parsedMessage.kind === "request" &&
      parsedMessage.request.method === "initialize"
    ) {
      const rpcRequest = parsedMessage.request;
      if (rpcRequest.id === undefined) {
        return createJSONRPCErrorResponse(
          400,
          -32600,
          "Initialize must be a JSON-RPC request",
          responseHeaders,
        );
      }
      if (request.headers.has("MCP-Session-Id")) {
        return createJSONRPCErrorResponse(
          400,
          -32600,
          "Initialize must not include MCP-Session-Id",
          responseHeaders,
        );
      }

      const context = extractRequestContext(request);
      let rpcResponse: JSONRPCResponse;
      try {
        rpcResponse = await handleRequest(rpcRequest, context);
      } catch {
        return createJSONRPCErrorResponse(
          500,
          -32603,
          "Internal error",
          responseHeaders,
        );
      }
      if (rpcResponse.error !== undefined) {
        return createJSONResponse(rpcResponse, { headers: responseHeaders });
      }

      const initializeResult = isRecord(rpcResponse.result) ? rpcResponse.result : undefined;
      const negotiatedVersion = initializeResult?.protocolVersion;
      if (!isSupportedMCPProtocolVersion(negotiatedVersion)) {
        return createJSONRPCErrorResponse(
          500,
          -32603,
          "Initialize response did not contain a supported protocol version",
          responseHeaders,
        );
      }

      const params = isRecord(rpcRequest.params) ? rpcRequest.params : {};
      const clientCaps = isRecord(params.capabilities) ? params.capabilities : {};
      let sessionId: string;
      try {
        sessionId = sessionManager.create();
      } catch {
        return createJSONRPCErrorResponse(
          503,
          -32000,
          "MCP session capacity reached",
          responseHeaders,
        );
      }
      sessionCapabilities.set(sessionId, clientCaps);
      if (authBinding !== undefined) {
        sessionAuthBindings.set(sessionId, authBinding);
      }
      sessionProtocolVersions.set(sessionId, negotiatedVersion);
      responseHeaders["MCP-Session-Id"] = sessionId;
      return createJSONResponse(rpcResponse, { headers: responseHeaders });
    }

    const suppliedSessionId = request.headers.get("MCP-Session-Id") ?? undefined;
    const sessionId = suppliedSessionId;
    if (sessionId) {
      if (!sessionManager.isActive(sessionId)) {
        return createJSONRPCErrorResponse(
          404,
          -32600,
          "Session not found or expired",
          responseHeaders,
        );
      }
      if (
        authEnabled &&
        sessionAuthBindings.get(sessionId) !== authBinding
      ) {
        return createJSONRPCErrorResponse(
          404,
          -32600,
          "Session not found or expired",
          responseHeaders,
        );
      }
    } else {
      return createJSONRPCErrorResponse(
        400,
        -32600,
        "Missing MCP-Session-Id header",
        responseHeaders,
      );
    }

    const protocolError = validateProtocolVersionHeader(
      request,
      sessionId,
      sessionProtocolVersions,
    );
    if (protocolError) {
      return createJSONRPCErrorResponse(
        400,
        -32600,
        protocolError,
        responseHeaders,
      );
    }
    if (!sessionManager.touch(sessionId)) {
      return createJSONRPCErrorResponse(
        404,
        -32600,
        "Session not found or expired",
        responseHeaders,
      );
    }

    if (parsedMessage.kind === "response") {
      return createEmptyResponse(202, responseHeaders);
    }

    const rpcRequest = parsedMessage.request;
    if (rpcRequest.id === undefined) {
      const context = extractRequestContext(request);
      try {
        await handleRequest(rpcRequest, context, sessionId);
      } catch {
        return createJSONRPCErrorResponse(
          500,
          -32603,
          "Internal error",
          responseHeaders,
        );
      }
      return createEmptyResponse(202, responseHeaders);
    }

    const context = extractRequestContext(request);
    let rpcResponse: JSONRPCResponse;
    try {
      rpcResponse = await handleRequest(rpcRequest, context, sessionId);
    } catch {
      return createJSONRPCErrorResponse(
        500,
        -32603,
        "Internal error",
        responseHeaders,
      );
    }
    return createJSONResponse(rpcResponse, { headers: responseHeaders });
  };
}

function validateProtocolVersionHeader(
  request: Request,
  sessionId: string | undefined,
  sessionProtocolVersions: ReadonlyMap<string, MCPSupportedProtocolVersion>,
): string | undefined {
  const provided = request.headers.get("MCP-Protocol-Version");
  if (provided !== null && !isSupportedMCPProtocolVersion(provided)) {
    return "Invalid or unsupported MCP-Protocol-Version header";
  }

  if (sessionId === undefined || provided === null) return undefined;
  const negotiated = sessionProtocolVersions.get(sessionId);
  if (negotiated === undefined) {
    return "Session protocol version is unavailable";
  }
  if (provided !== negotiated) {
    return "MCP-Protocol-Version does not match the negotiated session version";
  }
  return undefined;
}
