import type { ToolExecutionContext } from "#veryfront/tool";
import { VeryfrontError } from "#veryfront/security/input-validation/errors.ts";
import { validateContentType } from "#veryfront/security/input-validation/limits.ts";
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
  handleRequest: (
    request: JSONRPCRequest,
    context?: ToolExecutionContext,
  ) => Promise<JSONRPCResponse>;
  extractRequestContext: (request: Request) => ToolExecutionContext | undefined;
  isOriginAllowed: (requestOrigin?: string | null) => boolean;
  sessionCapabilities: Map<string, Record<string, unknown>>;
  sessionManager: SessionManager;
}

function createJSONResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function createJSONRPCErrorResponse(status: number, code: number, message: string): Response {
  return createJSONResponse(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code, message },
    },
    { status },
  );
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
    sessionManager,
  } = dependencies;

  return async (request: Request) => {
    const requestOrigin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCORSHeaders(requestOrigin) });
    }

    if (!isOriginAllowed(requestOrigin)) {
      return createJSONRPCErrorResponse(403, -32600, "Forbidden: Origin not allowed");
    }

    if (authEnabled) {
      const authorized = await validateAuth(request);
      if (!authorized) return new Response("Unauthorized", { status: 401 });
    }

    if (request.method === "DELETE") {
      const sessionId = request.headers.get("MCP-Session-Id");
      if (sessionId) {
        sessionManager.terminate(sessionId);
        sessionCapabilities.delete(sessionId);
      }
      return new Response(null, { status: 200, headers: getCORSHeaders(requestOrigin) });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_SIZE) {
      return createJSONRPCErrorResponse(413, -32600, "Request body too large");
    }

    try {
      validateContentType(request, JSON_CONTENT_TYPE);
    } catch (error) {
      const message = error instanceof VeryfrontError ? error.message : "Invalid Content-Type";
      return createJSONRPCErrorResponse(400, -32700, message);
    }

    let rpcRequest: JSONRPCRequest;
    try {
      const bodyText = await request.text();
      if (bodyText.length > MAX_REQUEST_BODY_SIZE) {
        return createJSONRPCErrorResponse(413, -32600, "Request body too large");
      }
      rpcRequest = JSON.parse(bodyText) as JSONRPCRequest;
    } catch (_) {
      return createJSONRPCErrorResponse(400, -32700, "Parse error");
    }

    const responseHeaders: Record<string, string> = {
      ...getCORSHeaders(requestOrigin),
    };

    if (rpcRequest.method === "initialize") {
      const context = extractRequestContext(request);
      const rpcResponse = await handleRequest(rpcRequest, context);
      const clientCaps =
        ((rpcRequest.params as Record<string, unknown> | undefined)?.capabilities ??
          {}) as Record<string, unknown>;
      const sessionId = sessionManager.create();
      sessionCapabilities.set(sessionId, clientCaps);
      responseHeaders["MCP-Session-Id"] = sessionId;
      return createJSONResponse(rpcResponse, { headers: responseHeaders });
    }

    if (sessionManager.size > 0) {
      const sessionId = request.headers.get("MCP-Session-Id");
      if (!sessionId) {
        return createJSONRPCErrorResponse(400, -32600, "Missing MCP-Session-Id header");
      }
      if (!sessionManager.isValid(sessionId)) {
        return createJSONRPCErrorResponse(404, -32600, "Session not found or expired");
      }
    }

    if (rpcRequest.id === undefined) {
      const context = extractRequestContext(request);
      await handleRequest(rpcRequest, context);
      return new Response(null, { status: 202, headers: responseHeaders });
    }

    const context = extractRequestContext(request);
    const rpcResponse = await handleRequest(rpcRequest, context);
    return createJSONResponse(rpcResponse, { headers: responseHeaders });
  };
}
