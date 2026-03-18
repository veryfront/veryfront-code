/**
 * Worker Script — Runs inside each per-project Deno Worker
 *
 * Handles messages from the main process, dynamically imports user modules,
 * and executes API route handlers in an isolated context.
 *
 * This file is the Worker entrypoint — it is loaded once when the Worker
 * is created and stays resident for the lifetime of the Worker.
 *
 * @module security/sandbox/worker-script
 */

import type {
  ExecuteAppRouteRequest,
  ExecutePagesRouteRequest,
  SerializedError,
  SerializedPagesContext,
  SerializedRequest,
  SerializedResponse,
  WorkerErrorResponse,
  WorkerRequest,
  WorkerResultResponse,
} from "./worker-types.ts";

// ---------------------------------------------------------------------------
// Serialization Helpers
// ---------------------------------------------------------------------------

function deserializeRequest(s: SerializedRequest): Request {
  return new Request(s.url, {
    method: s.method,
    headers: s.headers,
    body: s.body,
  });
}

function deserializePagesRequest(
  s: SerializedPagesContext,
): { request: Request; params: Record<string, string | string[]>; cookies: Record<string, string> } {
  const request = new Request(s.url, {
    method: s.method,
    headers: s.headers,
    body: s.body,
  });
  return { request, params: s.params, cookies: s.cookies };
}

async function serializeResponse(response: Response): Promise<SerializedResponse> {
  const body = response.body ? new Uint8Array(await response.arrayBuffer()) : null;
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body,
  };
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
    // Preserve RFC 9457 fields if present (VFError instances)
    const e = error as Record<string, unknown>;
    if (typeof e.type === "string") serialized.type = e.type;
    if (typeof e.status === "number") serialized.status = e.status;
    if (typeof e.detail === "string") serialized.detail = e.detail;
    return serialized;
  }
  return { message: String(error), name: "Error" };
}

// ---------------------------------------------------------------------------
// Module Cache
// ---------------------------------------------------------------------------

const moduleCache = new Map<string, Record<string, unknown>>();

async function loadModule(modulePath: string): Promise<Record<string, unknown>> {
  const cached = moduleCache.get(modulePath);
  if (cached) return cached;

  const mod = await import(`file://${modulePath}`) as Record<string, unknown>;
  moduleCache.set(modulePath, mod);
  return mod;
}

// ---------------------------------------------------------------------------
// Request Handlers
// ---------------------------------------------------------------------------

async function handleAppRoute(req: ExecuteAppRouteRequest): Promise<SerializedResponse> {
  const mod = await loadModule(req.modulePath);
  const method = req.method.toUpperCase();

  const handlerFn = (mod[method] ?? mod.default) as
    | ((request: Request, context: { params: Record<string, string> }) => Promise<Response> | Response)
    | undefined;

  if (!handlerFn) {
    return {
      status: 405,
      statusText: "Method Not Allowed",
      headers: [["content-type", "application/json"]],
      body: new TextEncoder().encode(JSON.stringify({ error: "Method not allowed" })),
    };
  }

  // App routes receive (Request, { params }) — params are extracted by the
  // main process during route matching and are not available here. Pass empty
  // params since we don't have access to route match data in this phase.
  // TODO(phase2): Include route params in the request message.
  const response = await handlerFn(deserializeRequest(req.request), { params: {} });
  return serializeResponse(response);
}

async function handlePagesRoute(req: ExecutePagesRouteRequest): Promise<SerializedResponse> {
  const mod = await loadModule(req.modulePath);
  const method = req.method as string;

  const handlerFn = (mod[method] ?? mod.default) as
    | ((ctx: unknown) => Promise<Response> | Response)
    | undefined;

  if (!handlerFn) {
    return {
      status: 405,
      statusText: "Method Not Allowed",
      headers: [["content-type", "application/json"]],
      body: new TextEncoder().encode(JSON.stringify({ error: "Method not allowed" })),
    };
  }

  const { request, params, cookies } = deserializePagesRequest(req.context);
  const url = new URL(request.url);

  // Build a minimal APIContext (subset of the full context)
  const ctx = {
    request,
    req: request,
    params,
    query: url.searchParams,
    cookies,
    headers: request.headers,
    url,
    json: (data: unknown, init?: ResponseInit): Response =>
      new Response(JSON.stringify(data), {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      }),
    text: (data: string, init?: ResponseInit): Response =>
      new Response(data, {
        ...init,
        headers: { "Content-Type": "text/plain", ...init?.headers },
      }),
    // fs is NOT provided in the isolated worker — user code that needs fs
    // must use the main process path (non-isolated mode).
  };

  const response = await handlerFn(ctx);
  return serializeResponse(response);
}

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<WorkerRequest | { type: "ping"; id: string }>) => {
  const msg = event.data;

  // Health check
  if (msg.type === "ping") {
    self.postMessage({ type: "pong", id: (msg as { id: string }).id });
    return;
  }

  const request = msg as WorkerRequest;

  try {
    let serializedResponse: SerializedResponse;

    switch (request.type) {
      case "execute-app-route":
        serializedResponse = await handleAppRoute(request);
        break;
      case "execute-pages-route":
        serializedResponse = await handlePagesRoute(request);
        break;
      default:
        throw new Error(`Unknown request type: ${(request as { type: string }).type}`);
    }

    const result: WorkerResultResponse = {
      type: "result",
      id: request.id,
      response: serializedResponse,
    };
    self.postMessage(result);
  } catch (error) {
    const errorResponse: WorkerErrorResponse = {
      type: "error",
      id: request.id,
      error: serializeError(error),
    };
    self.postMessage(errorResponse);
  }
};
