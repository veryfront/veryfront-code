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
  FetchDataRequest,
  RenderSSRRequest,
  SerializedDataContext,
  SerializedDataResult,
  SerializedError,
  SerializedPagesContext,
  SerializedRequest,
  SerializedResponse,
  WorkerDataResultResponse,
  WorkerErrorResponse,
  WorkerRequest,
  WorkerResultResponse,
  WorkerSSRResultResponse,
  WorkerStreamChunk,
  WorkerStreamEnd,
} from "./worker-types.ts";

// Module-level singletons to avoid per-call allocation churn
const encoder = new TextEncoder();

// Pre-import React at worker startup to avoid cold-start penalty on first SSR request.
// These are resolved from the project's import map. The dynamic imports are cached
// by the runtime, so subsequent calls are essentially free.
let _React: typeof import("react") | null = null;
let _ReactDOMServer: typeof import("react-dom/server") | null = null;

const _reactReady = (async () => {
  try {
    _React = await import("react");
    _ReactDOMServer = await import("react-dom/server");
  } catch {
    // React may not be available in all worker contexts (e.g., API-only workers).
    // SSR handler will throw a clear error if React is needed but not loaded.
  }
})();

// ---------------------------------------------------------------------------
// Serialization Helpers
// ---------------------------------------------------------------------------

function deserializeRequest(s: SerializedRequest): Request {
  return new Request(s.url, {
    method: s.method,
    headers: s.headers,
    body: s.body as BodyInit | null,
  });
}

function deserializePagesRequest(
  s: SerializedPagesContext,
): {
  request: Request;
  params: Record<string, string | string[]>;
  cookies: Record<string, string>;
} {
  const request = new Request(s.url, {
    method: s.method,
    headers: s.headers,
    body: s.body as BodyInit | null,
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
    const e = error as unknown as Record<string, unknown>;
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

function clearModuleCache(): void {
  moduleCache.clear();
}

// ---------------------------------------------------------------------------
// Project Env Overlay
// ---------------------------------------------------------------------------

function applyProjectEnv(env: Record<string, string> | undefined): void {
  if (!env) return;
  for (const [key, value] of Object.entries(env)) {
    Deno.env.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// Agent Discovery (per-project, cached per worker lifetime)
// ---------------------------------------------------------------------------

let discoveredProjectDir: string | null = null;

async function ensureAgentDiscovery(projectDir: string): Promise<void> {
  if (discoveredProjectDir === projectDir) return;

  try {
    const { discoverAll } = await import(
      "#veryfront/discovery/discovery-engine.ts"
    );
    const { agentRegistry } = await import(
      "#veryfront/agent/composition/composition.ts"
    );

    agentRegistry.clear();

    await discoverAll({
      baseDir: projectDir,
      verbose: false,
    });

    discoveredProjectDir = projectDir;
  } catch {
    // Discovery may fail in some environments — route handler will
    // return its own error (e.g. "Agent not found") which the main
    // process fallback handles.
  }
}

// ---------------------------------------------------------------------------
// Request Handlers
// ---------------------------------------------------------------------------

async function handleAppRoute(req: ExecuteAppRouteRequest): Promise<SerializedResponse> {
  applyProjectEnv(req.projectEnv);
  await ensureAgentDiscovery(req.projectDir);
  const mod = await loadModule(req.modulePath);
  const method = req.method.toUpperCase();

  const handlerFn = (mod[method] ?? mod.default) as
    | ((
      request: Request,
      context: { params: Record<string, string | string[]> },
    ) => Promise<Response> | Response)
    | undefined;

  if (!handlerFn) {
    return {
      status: 405,
      statusText: "Method Not Allowed",
      headers: [["content-type", "application/json"]],
      body: encoder.encode(JSON.stringify({ error: "Method not allowed" })),
    };
  }

  const response = await handlerFn(deserializeRequest(req.request), { params: req.params ?? {} });
  return serializeResponse(response);
}

function deserializeDataContext(
  s: SerializedDataContext,
): {
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  request: Request;
  url: URL;
} {
  const request = new Request(s.request.url, {
    method: s.request.method,
    headers: s.request.headers,
    body: s.request.body as BodyInit | null,
  });
  return {
    params: s.params,
    query: new URLSearchParams(s.query),
    request,
    url: new URL(s.url),
  };
}

async function handleFetchData(req: FetchDataRequest): Promise<SerializedDataResult> {
  const mod = await loadModule(req.modulePath);
  const getServerData = mod.getServerData as
    | ((ctx: unknown) => unknown | Promise<unknown>)
    | undefined;

  if (typeof getServerData !== "function") {
    return { props: {} };
  }

  const context = deserializeDataContext(req.context);
  const result = (await getServerData(context)) as SerializedDataResult;

  // Normalize the result shape
  if (result.redirect) return { redirect: result.redirect };
  if (result.notFound) return { notFound: true };
  return { props: result.props ?? {}, revalidate: result.revalidate };
}

async function handlePagesRoute(req: ExecutePagesRouteRequest): Promise<SerializedResponse> {
  applyProjectEnv(req.projectEnv);
  await ensureAgentDiscovery(req.projectDir);
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
      body: encoder.encode(JSON.stringify({ error: "Method not allowed" })),
    };
  }

  const { request, params, cookies } = deserializePagesRequest(req.context);
  const url = new URL(request.url);

  // Build a minimal read-only fs adapter scoped to the project directory
  const workerFs = {
    readTextFile: (path: string) => Deno.readTextFile(path),
    readFile: (path: string) => Deno.readFile(path),
    exists: async (path: string) => {
      try {
        await Deno.stat(path);
        return true;
      } catch {
        return false;
      }
    },
    stat: async (path: string) => {
      const info = await Deno.stat(path);
      return {
        isFile: info.isFile,
        isDirectory: info.isDirectory,
        isSymlink: info.isSymlink,
        size: info.size,
        mtime: info.mtime,
      };
    },
    readDir: async function* (path: string) {
      for await (const entry of Deno.readDir(path)) {
        yield { name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory };
      }
    },
  };

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
    fs: workerFs,
  };

  const response = await handlerFn(ctx);
  return serializeResponse(response);
}

// ---------------------------------------------------------------------------
// SSR Rendering Handler
// ---------------------------------------------------------------------------

/**
 * Handle SSR rendering in the isolated Worker.
 *
 * Imports the page + layout components from their temp file paths,
 * constructs a React element tree (layouts wrapping page), and renders
 * to HTML string. For streaming, sends chunks via postMessage.
 *
 * The Worker gets its own React instance — safe because SSR is
 * self-contained (no hydration mismatch concern).
 */
async function handleRenderSSR(
  req: RenderSSRRequest,
): Promise<{ html: string } | "streaming"> {
  // Wait for pre-imported React modules (loaded at worker startup)
  await _reactReady;

  if (!_React || !_ReactDOMServer) {
    throw new Error("React modules not available in this worker");
  }

  const React = _React;
  const { renderToString } = _ReactDOMServer;

  // Import the page component
  const pageMod = await loadModule(req.pageModulePath);
  const PageComponent = (pageMod.default ?? pageMod) as React.ComponentType<
    Record<string, unknown>
  >;

  // Import layout components (innermost → outermost order)
  const layoutComponents: React.ComponentType<Record<string, unknown>>[] = [];
  for (const layoutPath of req.layoutModulePaths) {
    const layoutMod = await loadModule(layoutPath);
    layoutComponents.push(
      (layoutMod.default ?? layoutMod) as React.ComponentType<
        Record<string, unknown>
      >,
    );
  }

  // Build element tree: page is innermost, layouts wrap outward
  const createElement = React.createElement as (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => React.ReactElement;

  let element: React.ReactElement = createElement(PageComponent, req.pageProps);

  for (let i = 0; i < layoutComponents.length; i++) {
    const Layout = layoutComponents[i];
    const layoutProps = req.layoutProps[i] ?? {};
    element = createElement(Layout, layoutProps, element);
  }

  // Streaming mode: send chunks via postMessage
  if (req.delivery === "stream") {
    // Use renderToReadableStream if available (React 18+)
    const serverModule = _ReactDOMServer as unknown as Record<string, unknown>;
    const renderToReadableStream = serverModule.renderToReadableStream as
      | ((element: React.ReactElement) => Promise<ReadableStream<Uint8Array>>)
      | undefined;

    if (renderToReadableStream) {
      const stream = await renderToReadableStream(element);
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const endMsg: WorkerStreamEnd = { type: "stream-end", id: req.id };
          self.postMessage(endMsg);
          break;
        }
        const chunkMsg: WorkerStreamChunk = {
          type: "stream-chunk",
          id: req.id,
          chunk: value,
        };
        // Transfer the Uint8Array for zero-copy
        self.postMessage(chunkMsg, { transfer: [value.buffer] });
      }

      return "streaming";
    }

    // Fallback: render to string if streaming not available
  }

  // String mode (or streaming fallback): render to string
  const html = renderToString(element);
  return { html };
}

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------

self.onmessage = async (
  event: MessageEvent<WorkerRequest | { type: "ping"; id: string } | { type: "clear-cache" }>,
) => {
  const msg = event.data;

  // Health check
  if (msg.type === "ping") {
    self.postMessage({ type: "pong", id: (msg as { id: string }).id });
    return;
  }

  // Module cache invalidation (for dev mode hot reload)
  if (msg.type === "clear-cache") {
    clearModuleCache();
    return;
  }

  const request = msg as WorkerRequest;

  try {
    // Data fetcher returns a different response shape than HTTP handlers
    if (request.type === "fetch-data") {
      const dataResult = await handleFetchData(request);
      const response: WorkerDataResultResponse = {
        type: "data-result",
        id: request.id,
        result: dataResult,
      };
      self.postMessage(response);
      return;
    }

    // SSR rendering — may stream chunks or return HTML string
    if (request.type === "render-ssr") {
      const ssrResult = await handleRenderSSR(request);

      // If streaming, chunks were already sent via postMessage
      if (ssrResult === "streaming") return;

      const ssrResponse: WorkerSSRResultResponse = {
        type: "ssr-result",
        id: request.id,
        html: ssrResult.html,
      };
      self.postMessage(ssrResponse);
      return;
    }

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
