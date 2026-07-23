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
  ExecuteAgentRunRequest,
  ExecuteAppRouteRequest,
  ExecutePagesRouteRequest,
  ExecuteProjectRunRequest,
  FetchDataRequest,
  GenerateOpenAPISpecRequest,
  RenderSSRRequest,
  SerializedDataContext,
  SerializedDataResult,
  SerializedError,
  SerializedPagesContext,
  SerializedRequest,
  SerializedResponse,
  WorkerDataResultResponse,
  WorkerErrorResponse,
  WorkerOpenAPIResultResponse,
  WorkerProjectRunResultResponse,
  WorkerRequest,
  WorkerResultResponse,
  WorkerSSRResultResponse,
  WorkerStreamChunk,
  WorkerStreamEnd,
} from "./worker-types.ts";
import { MAX_WORKER_RESPONSE_BODY_BYTES } from "./worker-types.ts";
import {
  assertValidProjectRunWorkerRequest,
  snapshotProjectRunWorkerResult,
} from "./project-run-worker-contract.ts";
import type { SerializedProjectRunResult } from "./worker-types.ts";
import { installWorkerEgressGuard, type WorkerEgressGuardOptions } from "./worker-egress-guard.ts";
import { isAbsolute, relative, resolve as resolvePath, sep as PATH_SEP } from "node:path";
import { pathToFileURL } from "node:url";
import { isDataResultWithinLimit } from "#veryfront/data/data-result-limits.ts";
import { assertValidOpenAPIWorkerRequest } from "#veryfront/routing/api/openapi/worker-contract.ts";
import { validateOpenAPISpec } from "#veryfront/routing/api/openapi/spec-validation.ts";
import type {
  AgentRunWorkerControlCommand,
  AgentRunWorkerEvent,
} from "./agent-run-worker-contract.ts";
import { AgentRunWorkerRuntime } from "./agent-run-worker-runtime.ts";
import {
  runWithWorkerSourceIntegrationPolicy,
  withWorkerProjectEnv,
} from "./worker-runtime-context.ts";

// Module-level singletons to avoid per-call allocation churn
const encoder = new TextEncoder();
type WorkerResponseSender = (
  message: unknown,
  options?: StructuredSerializeOptions,
) => void;
let postWorkerMessage: WorkerResponseSender = typeof self.postMessage === "function"
  ? self.postMessage.bind(self)
  : (_message: unknown, _options?: StructuredSerializeOptions) => {
    throw new TypeError("Worker messaging is unavailable");
  };
type InitializeEgressMessage = {
  type: "initialize-egress";
  options: WorkerEgressGuardOptions;
  projectEnvKeys?: string[];
  responsePort?: MessagePort;
};
let egressInitialized = false;
let exitNotifierInstalled = false;
let privateTransportPort: MessagePort | null = null;
const agentRunWorkerRuntime = new AgentRunWorkerRuntime();

function postAgentRunWorkerEvent(
  event: AgentRunWorkerEvent,
  transfer: Transferable[] = [],
): void {
  postWorkerMessage(event, transfer.length > 0 ? { transfer } : undefined);
}

function installWorkerExitNotifier(): void {
  if (exitNotifierInstalled || typeof globalThis.close !== "function") return;

  const notifyExit = () => postWorkerMessage({ type: "worker-exit" });
  const closeWorker = globalThis.close.bind(globalThis);
  globalThis.close = () => {
    try {
      notifyExit();
    } finally {
      closeWorker();
    }
  };
  if (typeof Deno.exit === "function") {
    const exitWorker = Deno.exit.bind(Deno);
    Deno.exit = ((code?: number): never => {
      try {
        notifyExit();
      } catch {
        // Exit even if the notification channel is already closed.
      }
      return exitWorker(code);
    }) as typeof Deno.exit;
  }
  exitNotifierInstalled = true;
}

function blockProjectAccessToPublicWorkerMessaging(): void {
  const deniedPostMessage = () => {
    throw new DOMException("Project modules cannot access the worker transport", "SecurityError");
  };
  try {
    Object.defineProperty(self, "postMessage", {
      configurable: false,
      enumerable: true,
      get: () => deniedPostMessage,
      // Preserve compatibility with modules that replace postMessage without
      // using it. Framework responses use the private channel captured below.
      set: () => {},
    });
  } catch {
    // The host rejects every message on the public channel after initialization,
    // so failure to shadow the global still fails closed.
  }
}

/** True when `child` is the same as, or nested under, `root`. Cross-platform. */
function isContained(root: string, child: string): boolean {
  if (child === root) return true;
  const rel = relative(root, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${PATH_SEP}`) && !isAbsolute(rel);
}

async function tryRealPath(path: string): Promise<string | null> {
  try {
    return await Deno.realPath(path);
  } catch {
    return null;
  }
}

/**
 * Build a path guard that confines filesystem access to `projectDir`.
 *
 * Worker permissions restrict direct Deno filesystem reads to an explicit
 * allow-list, and this read-only `ctx.fs` adapter further confines framework
 * filesystem access to the project directory. The guard is both:
 *  - cross-platform (uses `relative()`, not a hard-coded `/` separator), and
 *  - symlink-safe (canonicalizes via `Deno.realPath` so a symlink inside the
 *    project that points outside it is rejected, not followed).
 */
export function makeProjectPathGuard(projectDir: string): (path: string) => Promise<string> {
  const root = resolvePath(projectDir);
  let realRootPromise: Promise<string> | null = null;

  return async (path: string): Promise<string> => {
    const resolved = resolvePath(root, path);

    // Lexical containment first — cheap, and catches plain `../` traversal
    // even when the target doesn't exist yet.
    if (!isContained(root, resolved)) {
      throw new Error(`Path escapes project directory: ${path}`);
    }

    // Canonicalize to defeat symlinks that escape the project. realPath fails
    // for a not-yet-existing target (e.g. a fresh path); the lexical check
    // above already covers that case, so fall back to the resolved path.
    realRootPromise ??= tryRealPath(root).then((r) => r ?? root);
    const realRoot = await realRootPromise;
    const realResolved = await tryRealPath(resolved);
    if (realResolved !== null && !isContained(realRoot, realResolved)) {
      throw new Error(`Path escapes project directory: ${path}`);
    }

    return realResolved ?? resolved;
  };
}

// Load React lazily for SSR requests. API-only workers and health checks should
// start without resolving React, and the runtime caches dynamic imports after
// the first SSR request.
let _React: typeof import("react") | null = null;
let _ReactDOMServer: typeof import("react-dom/server") | null = null;
let _reactReady: Promise<void> | null = null;

function ensureReactReady(): Promise<void> {
  _reactReady ??= (async () => {
    try {
      _React = await import("react");
      _ReactDOMServer = await import("react-dom/server");
    } catch {
      // React may not be available in all worker contexts (e.g., API-only workers).
      // SSR handler will throw a clear error if React is needed but not loaded.
    }
  })();
  return _reactReady;
}

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

export async function serializeResponse(response: Response): Promise<SerializedResponse> {
  const body = await readResponseBodyWithLimit(response);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body,
  };
}

async function readResponseBodyWithLimit(response: Response): Promise<Uint8Array | null> {
  if (!response.body) return null;

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))) {
      await response.body.cancel().catch(() => {});
      throw new TypeError("Isolated response Content-Length is invalid");
    }
    if (Number(contentLength) > MAX_WORKER_RESPONSE_BODY_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new RangeError("Isolated response body exceeds the transfer limit");
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_WORKER_RESPONSE_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new RangeError("Isolated response body exceeds the transfer limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      message: safeStringProperty(error, "message", "Unknown worker error", 16_384),
      name: safeStringProperty(error, "name", "Error", 256),
    };
    // Preserve the stable registry identity used to reconstruct VeryfrontError
    // instances in the host process. Keep legacy RFC fields for compatibility.
    const slug = safeProperty(error, "slug");
    const type = safeProperty(error, "type");
    const status = safeProperty(error, "status");
    const detail = safeProperty(error, "detail");
    if (typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      serialized.slug = slug.slice(0, 128);
    }
    if (typeof type === "string") serialized.type = type.slice(0, 2_048);
    if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
      serialized.status = status;
    }
    if (typeof detail === "string") serialized.detail = detail.slice(0, 16_384);
    return serialized;
  }
  return { message: safeString(error, "Unknown worker error", 16_384), name: "Error" };
}

function safeProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function safeString(value: unknown, fallback: string, maximumLength: number): string {
  try {
    return String(value).slice(0, maximumLength);
  } catch {
    return fallback;
  }
}

function safeStringProperty(
  value: object,
  key: string,
  fallback: string,
  maximumLength: number,
): string {
  const property = safeProperty(value, key);
  return typeof property === "string" ? property.slice(0, maximumLength) : fallback;
}

// ---------------------------------------------------------------------------
// Module Cache
// ---------------------------------------------------------------------------

const moduleCache = new Map<string, Record<string, unknown>>();

export async function loadModule(modulePath: string): Promise<Record<string, unknown>> {
  const cached = moduleCache.get(modulePath);
  if (cached) return cached;

  const mod = await import(pathToFileURL(modulePath).href) as Record<string, unknown>;
  moduleCache.set(modulePath, mod);
  return mod;
}

export function clearModuleCache(): void {
  moduleCache.clear();
}

export function resolveWorkerRouteMethod(
  mod: Record<string, unknown>,
  method: string,
): unknown {
  switch (method.toUpperCase()) {
    case "DELETE":
      return mod.DELETE;
    case "GET":
      return mod.GET;
    case "HEAD":
      return mod.HEAD ?? mod.GET;
    case "OPTIONS":
      return mod.OPTIONS;
    case "PATCH":
      return mod.PATCH;
    case "POST":
      return mod.POST;
    case "PUT":
      return mod.PUT;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Project Env Overlay
// ---------------------------------------------------------------------------

/** Apply a request-scoped environment overlay and restore it afterward. @internal */
export async function withProjectEnv<T>(
  env: Record<string, string> | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return await withWorkerProjectEnv(env, operation);
}

// ---------------------------------------------------------------------------
// Agent Discovery (per-project, cached per worker lifetime)
// ---------------------------------------------------------------------------

let discoveredProjectDir: string | null = null;

async function ensureAgentDiscovery(projectDir: string): Promise<void> {
  if (discoveredProjectDir === projectDir) return;

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
}

// ---------------------------------------------------------------------------
// Request Handlers
// ---------------------------------------------------------------------------

async function handleAppRoute(req: ExecuteAppRouteRequest): Promise<SerializedResponse> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    () =>
      withProjectEnv(req.projectEnv, async () => {
        await ensureAgentDiscovery(req.projectDir);
        const mod = await loadModule(req.modulePath);

        const handlerFn = (resolveWorkerRouteMethod(mod, req.method) ?? mod.default) as
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

        const response = await handlerFn(deserializeRequest(req.request), {
          params: req.params ?? {},
        });
        return serializeResponse(response);
      }),
  );
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
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    async () => {
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
      const normalized: SerializedDataResult = result.redirect
        ? { redirect: result.redirect }
        : result.notFound
        ? { notFound: true }
        : { props: result.props ?? {}, revalidate: result.revalidate };
      if (!isDataResultWithinLimit(normalized)) {
        throw new RangeError("getServerData result exceeds the data result limit");
      }
      return normalized;
    },
  );
}

async function handlePagesRoute(req: ExecutePagesRouteRequest): Promise<SerializedResponse> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    () =>
      withProjectEnv(req.projectEnv, async () => {
        await ensureAgentDiscovery(req.projectDir);
        const mod = await loadModule(req.modulePath);

        const handlerFn = (resolveWorkerRouteMethod(mod, req.method) ?? mod.default) as
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

        // Build a minimal read-only fs adapter scoped to the project directory.
        // Every path is validated against the project root before it reaches a
        // Deno API so user route handlers cannot read arbitrary host files.
        const assertContained = makeProjectPathGuard(req.projectDir);
        const workerFs = {
          readTextFile: async (path: string) => Deno.readTextFile(await assertContained(path)),
          readFile: async (path: string) => Deno.readFile(await assertContained(path)),
          exists: async (path: string) => {
            const safePath = await assertContained(path);
            try {
              await Deno.stat(safePath);
              return true;
            } catch (error) {
              if (
                error instanceof Deno.errors.NotFound ||
                error instanceof Deno.errors.NotADirectory
              ) return false;
              throw error;
            }
          },
          stat: async (path: string) => {
            const info = await Deno.stat(await assertContained(path));
            return {
              isFile: info.isFile,
              isDirectory: info.isDirectory,
              isSymlink: info.isSymlink,
              size: info.size,
              mtime: info.mtime,
            };
          },
          readDir: async function* (path: string) {
            const safePath = await assertContained(path);
            for await (const entry of Deno.readDir(safePath)) {
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
      }),
  );
}

async function loadModuleCode(code: string): Promise<Record<string, unknown>> {
  const moduleUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(moduleUrl) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

interface WorkerDefinitionHandler {
  validate(value: unknown): boolean;
  getId(value: never, file: string, dir: string): string;
  register(id: string, value: never, file: string, dir: string, exportName?: string): unknown;
}

interface WorkerDefinitionCandidate {
  exportName: string;
  value: unknown;
}

function isIndexDiscoveryModule(file: string): boolean {
  const normalized = file.replace(/^file:\/\//, "");
  return /(?:^|\/)index\.(?:ts|tsx|js|jsx|mjs)$/.test(normalized);
}

function collectWorkerDefinitionCandidates(
  module: Record<string, unknown>,
  handler: WorkerDefinitionHandler,
): WorkerDefinitionCandidate[] {
  const exportNames = Object.keys(module);
  if (exportNames.length > 1_000) {
    throw new RangeError("Project definition module export limit exceeded");
  }

  const candidates: WorkerDefinitionCandidate[] = [];
  const seen = new Set<unknown>();
  const defaultExport = module.default;
  if (handler.validate(defaultExport)) {
    candidates.push({ exportName: "default", value: defaultExport });
    seen.add(defaultExport);
  }
  for (const exportName of exportNames) {
    if (exportName === "default") continue;
    const value = module[exportName];
    if (!handler.validate(value) || seen.has(value)) continue;
    candidates.push({ exportName, value });
    seen.add(value);
  }
  return candidates;
}

async function findWorkerProjectDefinition(
  request: ExecuteProjectRunRequest,
  handler: WorkerDefinitionHandler,
  filenameToId: (file: string) => string,
): Promise<unknown | null> {
  for (const source of request.modules) {
    try {
      const module = await loadModuleCode(source.moduleCode);
      const candidates = collectWorkerDefinitionCandidates(module, handler);
      const useExportNameFallback = candidates.length > 1 || isIndexDiscoveryModule(source.file);

      for (const candidate of candidates) {
        const derivedId = handler.getId(candidate.value as never, source.file, source.dir);
        const id = useExportNameFallback && candidate.exportName !== "default" &&
            derivedId === filenameToId(source.file)
          ? candidate.exportName
          : derivedId;
        if (id !== request.targetId) continue;
        return handler.register(
          id,
          candidate.value as never,
          source.file,
          source.dir,
          candidate.exportName,
        );
      }
    } catch {
      // Match normal discovery behavior: one invalid source does not prevent a
      // later valid source from satisfying the requested definition id.
    }
  }
  return null;
}

function normalizeWorkerDatasetPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 || normalized.length > 4_096 || normalized.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError("Remote eval dataset path must be project-relative");
  }
  return normalized;
}

function parseWorkerDatasetExamples(kind: "json" | "jsonl", content: string): unknown[] {
  if (kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new TypeError("Remote eval dataset must contain valid JSON");
    }
    if (Array.isArray(parsed)) return parsed;
    if (
      parsed !== null && typeof parsed === "object" &&
      Array.isArray((parsed as { examples?: unknown }).examples)
    ) {
      return (parsed as { examples: unknown[] }).examples;
    }
    throw new TypeError("Remote eval JSON dataset must contain examples");
  }

  return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new TypeError("Remote eval dataset must contain valid JSONL");
    }
  });
}

async function prepareWorkerEvalDefinition(
  definition: import("#veryfront/eval/types.ts").EvalDefinition,
  request: Extract<ExecuteProjectRunRequest, { kind: "eval" }>,
): Promise<import("#veryfront/eval/types.ts").EvalDefinition> {
  const repetitionsValue = request.config.repetitions ?? request.config.repeat ??
    request.config.repetitionCount;
  let repetitions = definition.repetitions;
  if (
    typeof repetitionsValue === "number" && Number.isFinite(repetitionsValue) &&
    Math.trunc(repetitionsValue) > 0
  ) {
    repetitions = Math.trunc(repetitionsValue);
  } else if (typeof repetitionsValue === "string" && repetitionsValue.trim() !== "") {
    const parsed = Number.parseInt(repetitionsValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) repetitions = parsed;
  }

  if (definition.dataset.kind === "inline") {
    return repetitions === definition.repetitions ? definition : { ...definition, repetitions };
  }
  if (
    (definition.dataset.kind !== "json" && definition.dataset.kind !== "jsonl") ||
    typeof definition.dataset.path !== "string"
  ) {
    throw new TypeError("Remote eval dataset kind is unsupported");
  }

  const path = normalizeWorkerDatasetPath(definition.dataset.path);
  let source: (typeof request.datasetFiles)[number] | undefined;
  for (let index = 0; index < request.datasetFiles.length; index++) {
    const candidate = request.datasetFiles[index];
    if (candidate?.path !== path) continue;
    source = candidate;
    break;
  }
  if (!source) throw new TypeError("Remote eval dataset file is unavailable");
  const { normalizeEvalExamples } = await import("#veryfront/eval/validation.ts");
  const examples = normalizeEvalExamples(
    parseWorkerDatasetExamples(
      definition.dataset.kind,
      source.content,
    ) as import("#veryfront/eval/types.ts").EvalExampleInput[],
    "remote eval dataset",
  );
  const dataset = {
    ...definition.dataset,
    path,
    async load() {
      return examples.map((example) => ({ ...example }));
    },
  };
  return { ...definition, dataset, ...(repetitions === undefined ? {} : { repetitions }) };
}

function isBlockingWorkerEvalResult(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const result = value as { skipped?: unknown; pass?: unknown; severity?: unknown };
  return result.skipped !== true && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget");
}

function countWorkerEvalFailures(report: import("#veryfront/eval/types.ts").EvalReport): number {
  return report.records.filter((record) =>
    !record.completed || Boolean(record.error) ||
    [...(record.metrics ?? []), ...(record.checks ?? [])].some(isBlockingWorkerEvalResult)
  ).length;
}

async function executeWorkerTask(
  request: Extract<ExecuteProjectRunRequest, { kind: "task" }>,
): Promise<SerializedProjectRunResult> {
  const [{ taskHandler }, { filenameToId }, { runTaskWithRuntimeEnvironment }] = await Promise.all([
    import("#veryfront/discovery/handlers/task-handler.ts"),
    import("#veryfront/discovery/discovery-utils.ts"),
    import("#veryfront/task/runner.ts"),
  ]);
  const definition = await findWorkerProjectDefinition(
    request,
    taskHandler as WorkerDefinitionHandler,
    filenameToId,
  ) as import("#veryfront/task/types.ts").TaskDefinition | null;
  if (!definition) {
    return snapshotProjectRunWorkerResult({
      success: false,
      error: `Task not found: ${request.targetId}`,
      durationMs: 0,
    });
  }

  const result = await runTaskWithRuntimeEnvironment(
    {
      task: {
        id: request.targetId,
        name: definition.name ?? request.targetId,
        definition,
      },
      config: request.config,
      projectId: request.projectId,
      environmentId: request.environmentId,
      envAllowlist: Object.keys(request.projectEnv ?? {}),
      debug: request.debug,
    },
    request.projectEnv ?? {},
  );
  return snapshotProjectRunWorkerResult(result);
}

async function executeWorkerEval(
  request: Extract<ExecuteProjectRunRequest, { kind: "eval" }>,
): Promise<SerializedProjectRunResult> {
  const startedAt = performance.now();
  const isolatedFetch = globalThis.fetch.bind(globalThis);
  const [{ evalHandler }, { filenameToId }, { runEval }, { createAgentServiceEvalAdapter }] =
    await Promise.all([
      import("#veryfront/discovery/handlers/eval-handler.ts"),
      import("#veryfront/discovery/discovery-utils.ts"),
      import("#veryfront/eval/runner.ts"),
      import("#veryfront/eval/agent-service.ts"),
    ]);
  const discovered = await findWorkerProjectDefinition(
    request,
    evalHandler as WorkerDefinitionHandler,
    filenameToId,
  ) as import("#veryfront/eval/types.ts").EvalDefinition | null;
  if (!discovered) {
    return snapshotProjectRunWorkerResult({
      success: false,
      error: `Eval not found: ${request.targetId}`,
      durationMs: 0,
    });
  }

  const definition = await prepareWorkerEvalDefinition(discovered, request);
  const targetAgentId = definition.targetKind === "agent"
    ? definition.target.replace(/^agent:/, "")
    : undefined;
  const report = await runEval(definition, {
    adapters: {
      agent: createAgentServiceEvalAdapter({
        ...request.evalAgentAdapter,
        ...(targetAgentId ? { agentId: targetAgentId } : {}),
        fetch: isolatedFetch,
      }),
    },
    baseDir: request.projectDir,
    runId: request.runId,
  });
  const failed = Math.max(report.summary.failed, countWorkerEvalFailures(report));
  return snapshotProjectRunWorkerResult({
    success: failed === 0,
    result: report,
    ...(failed > 0 ? { error: `${failed} eval record${failed === 1 ? "" : "s"} failed` } : {}),
    durationMs: Math.max(0, performance.now() - startedAt),
  });
}

/** Execute one project task or eval without evaluating its modules in the host process. */
export async function handleExecuteProjectRun(
  request: ExecuteProjectRunRequest,
): Promise<SerializedProjectRunResult> {
  assertValidProjectRunWorkerRequest(request);
  return await runWithWorkerSourceIntegrationPolicy(
    request.sourceIntegrationPolicy,
    () =>
      withProjectEnv(
        request.projectEnv,
        () => request.kind === "task" ? executeWorkerTask(request) : executeWorkerEval(request),
      ),
  );
}

/** Generate a complete spec while every project module remains inside the Worker. */
export async function handleGenerateOpenAPI(
  req: GenerateOpenAPISpecRequest,
): Promise<ReturnType<typeof validateOpenAPISpec>> {
  assertValidOpenAPIWorkerRequest(req);

  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    () =>
      withProjectEnv(req.projectEnv, async () => {
        const { generateOpenAPISpecFromModules } = await import(
          "#veryfront/routing/api/openapi/spec-generator.ts"
        );
        async function* loadRoutes() {
          for (const route of req.routes) {
            yield {
              pattern: route.pattern,
              module: await loadModuleCode(route.moduleCode),
            };
          }
        }
        const spec = await generateOpenAPISpecFromModules(loadRoutes(), undefined, {
          title: req.info.title,
          version: req.info.version,
          description: req.info.description,
          servers: req.info.servers,
        });
        return validateOpenAPISpec(spec);
      }),
  );
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
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    async () => await renderSSR(req),
  );
}

async function renderSSR(
  req: RenderSSRRequest,
): Promise<{ html: string } | "streaming"> {
  // Load React only for SSR workers. API-only workers and health checks should
  // not pay the React import cost or contend on it under parallel worker tests.
  await ensureReactReady();

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
          postWorkerMessage(endMsg);
          break;
        }
        const chunkMsg: WorkerStreamChunk = {
          type: "stream-chunk",
          id: req.id,
          chunk: value,
        };
        // Transfer the Uint8Array for zero-copy
        postWorkerMessage(chunkMsg, { transfer: [value.buffer] });
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

async function processWorkerRequest(request: WorkerRequest): Promise<void> {
  try {
    if (!egressInitialized) {
      throw new Error("Worker egress guard is not initialized");
    }

    // Data fetcher returns a different response shape than HTTP handlers
    if (request.type === "fetch-data") {
      const dataResult = await handleFetchData(request);
      const response: WorkerDataResultResponse = {
        type: "data-result",
        id: request.id,
        result: dataResult,
      };
      postWorkerMessage(response);
      return;
    }

    if (request.type === "generate-openapi-spec") {
      const spec = await handleGenerateOpenAPI(request);
      const response: WorkerOpenAPIResultResponse = {
        type: "openapi-result",
        id: request.id,
        spec,
      };
      postWorkerMessage(response);
      return;
    }

    if (request.type === "execute-project-run") {
      const projectRunResult = await handleExecuteProjectRun(request);
      const response: WorkerProjectRunResultResponse = {
        type: "project-run-result",
        id: request.id,
        result: projectRunResult,
      };
      postWorkerMessage(response);
      return;
    }

    if (request.type === "execute-agent-run") {
      await agentRunWorkerRuntime.execute(
        request as ExecuteAgentRunRequest,
        postAgentRunWorkerEvent,
      );
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
      postWorkerMessage(ssrResponse);
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
    postWorkerMessage(result);
  } catch (error) {
    const errorResponse: WorkerErrorResponse = {
      type: "error",
      id: request.id,
      error: serializeError(error),
    };
    postWorkerMessage(errorResponse);
  }
}

let requestQueue: Promise<void> = Promise.resolve();

function handleWorkerMessage(
  event: MessageEvent<
    | WorkerRequest
    | InitializeEgressMessage
    | AgentRunWorkerControlCommand
    | { type: "ping"; id: string }
    | { type: "clear-cache" }
  >,
): void {
  // Deno marks real Worker and MessagePort delivery as trusted. Initialization
  // is the only public-channel message; every later request uses the transferred
  // private port, which project modules cannot observe or synthesize.
  const expectedTarget = egressInitialized ? privateTransportPort : self;
  if (
    !event.isTrusted || event.origin !== "" || event.source !== null ||
    event.currentTarget !== expectedTarget
  ) return;

  const msg = event.data;

  if (msg.type === "initialize-egress") {
    if (!egressInitialized) {
      if (msg.responsePort instanceof MessagePort) {
        privateTransportPort = msg.responsePort;
        const privatePostMessage = privateTransportPort.postMessage.bind(privateTransportPort);
        postWorkerMessage = (message, options) => privatePostMessage(message, options);
        privateTransportPort.onmessage = handleWorkerMessage;
        privateTransportPort.onmessageerror = () => globalThis.close();
        privateTransportPort.start();
        self.removeEventListener("message", handleWorkerMessage);
      } else {
        throw new TypeError("Worker initialization requires a private transport");
      }
      // A Deno Worker inherits allowed host environment values. Remove every
      // project-scoped key before importing project code so a key-name
      // collision cannot expose the host's value between request overlays.
      for (const key of msg.projectEnvKeys ?? []) Deno.env.delete(key);
      installWorkerExitNotifier();
      installWorkerEgressGuard(msg.options);
      blockProjectAccessToPublicWorkerMessaging();
      egressInitialized = true;
    }
    return;
  }

  // Health check
  if (msg.type === "ping") {
    postWorkerMessage({ type: "pong", id: (msg as { id: string }).id });
    return;
  }

  // Module cache invalidation (for dev mode hot reload)
  if (msg.type === "clear-cache") {
    clearModuleCache();
    return;
  }

  if (
    msg.type === "agent-run-resume" || msg.type === "agent-run-cancel" ||
    msg.type === "agent-run-detach" || msg.type === "agent-stream-credit"
  ) {
    if (egressInitialized) {
      agentRunWorkerRuntime.handleControl(msg, postAgentRunWorkerEvent);
    }
    return;
  }

  const request = msg as WorkerRequest;
  // User code runs in the worker process and may read process-global state such
  // as Deno.env. Keep requests non-overlapping so per-request env overlays
  // cannot bleed across async handlers in the same pooled worker.
  requestQueue = requestQueue.then(
    () => processWorkerRequest(request),
    () => processWorkerRequest(request),
  );
}

self.addEventListener("message", handleWorkerMessage);
