/**
 * In-process request harness.
 *
 * Drives the request pipeline that both servers wrap — `createVeryfrontHandler`
 * for production, the dev `RequestHandler` around it for development — without
 * binding a port. Tests hand it the project files they care about and get back
 * a `handle()` that behaves like a request arriving over loopback. No listener,
 * no port allocation, no readiness polling, nothing to drain on shutdown.
 *
 * Builds on `withTestContext` for everything that is not the handler: the temp
 * project layout, the isolated cache dir, state reset on both sides of the
 * test, contract re-registration, and env/resource cleanup.
 *
 * ```ts
 * await withInProcessProject("api-json", {
 *   files: { "pages/api/hello.ts": `export const GET = () => Response.json({ ok: true });` },
 * }, async (project) => {
 *   const res = await project.handle("/api/hello");
 *   assertEquals(await res.json(), { ok: true });
 * });
 * ```
 */

import { dirname, join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "../../src/platform/compat/fs.ts";
import type { RuntimeAdapter } from "../../src/platform/adapters/base.ts";
import { runtime } from "../../src/platform/adapters/registry.ts";
import {
  recordRequestPeerFromTransport,
  type RequestPeerRuntime,
} from "../../src/platform/adapters/runtime/shared/request-peer.ts";
import { MiddlewarePipeline } from "../../src/middleware/core/pipeline/pipeline.ts";
import { bootstrapDev, bootstrapProd } from "../../src/server/bootstrap.ts";
import { setupMiddleware } from "../../src/server/dev-server/middleware.ts";
import { RequestHandler } from "../../src/server/dev-server/request-handler.ts";
import { setServerInitialized } from "../../src/server/handlers/monitoring/health.handler.ts";
import { createVeryfrontHandler } from "../../src/server/runtime-handler/index.ts";
import { type TestContext, withTestContext } from "./context.ts";

/** Origin every path-form `handle()` call is resolved against. */
export const IN_PROCESS_ORIGIN = "http://localhost";

export type InProcessMode = "dev" | "production";

export interface InProcessProjectOptions {
  /** Project files, relative path → contents, written before the handler is built. */
  readonly files?: Readonly<Record<string, string>>;
  /** Replaces the default `veryfront.config.js` with `export default <json>`. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** Which server's handler wraps the pipeline. Defaults to `"dev"`. */
  readonly mode?: InProcessMode;
}

export interface InProcessProject {
  readonly projectDir: string;
  readonly projectId: string;
  readonly mode: InProcessMode;
  /** The underlying context, for `setEnv`, `addCleanup`, and the cache dir. */
  readonly context: TestContext;
  /**
   * Send one request through the pipeline. A string is a path (and optional
   * query) resolved against `IN_PROCESS_ORIGIN` as a GET; `init` applies to
   * the path form only. The request is stamped with a loopback peer so it is
   * admitted exactly as a connection from 127.0.0.1 would be.
   */
  handle(request: Request | string, init?: RequestInit): Promise<Response>;
}

async function writeProjectFiles(
  projectDir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(projectDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeTextFile(target, contents);
  }
}

/**
 * Every HTTP/1.1 client sends a `Host` header and several admission checks
 * (privileged local-control surfaces) require it to match the URL authority.
 * An in-process `Request` starts without one, so stamp it like the wire would.
 */
function withHostHeader(request: Request): Request {
  if (request.headers.has("host")) return request;
  const headers = new Headers(request.headers);
  headers.set("host", new URL(request.url).host);
  return new Request(request, { headers });
}

function toRequest(request: Request | string, init?: RequestInit): Request {
  const built = request instanceof Request
    ? request
    : new Request(new URL(request, IN_PROCESS_ORIGIN), init);
  return withHostHeader(built);
}

/**
 * A server never writes a body for a HEAD response (`Deno.serve` discards it
 * at the transport); mirror that so handlers may answer HEAD like GET.
 */
async function stripHeadBody(response: Response): Promise<Response> {
  if (response.body === null) return response;
  await response.body.cancel();
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function peerRuntimeFor(adapter: RuntimeAdapter): RequestPeerRuntime {
  return adapter.id === "node" || adapter.id === "bun" ? adapter.id : "deno";
}

interface PipelineHandle {
  readonly handle: (request: Request) => Promise<Response>;
  readonly teardown: () => Promise<void>;
}

/**
 * Close every `MessageChannel` the pipeline opens while it is alive.
 *
 * The React SSR adapter imports `react-dom/server` from an esm.sh bundle cached
 * under the test's own cache dir, so each test instantiates the module afresh.
 * That bundle (`react-dom-server.browser`) opens a module-scope
 * `MessageChannel` for `scheduleWork` and never closes it; the module is
 * orphaned by `resetReactCache()` at the end of the test, but its port keeps a
 * receive op pending and the sanitizer reports it. The port is module-private,
 * so the only handle on it is the constructor call. Tracking channels here and
 * closing them once the pipeline is torn down is what lets tests on this
 * harness keep the sanitizers on.
 */
function trackMessageChannels(): () => void {
  const NativeMessageChannel = globalThis.MessageChannel;
  const opened: MessageChannel[] = [];
  globalThis.MessageChannel = class TrackedMessageChannel extends NativeMessageChannel {
    constructor() {
      super();
      opened.push(this);
    }
  };
  return () => {
    globalThis.MessageChannel = NativeMessageChannel;
    for (const channel of opened) {
      channel.port1.close();
      channel.port2.close();
    }
  };
}

async function buildProductionPipeline(
  context: TestContext,
  adapter: RuntimeAdapter,
): Promise<PipelineHandle> {
  const { projectDir, projectId } = context;
  const bootstrap = await bootstrapProd(projectDir, adapter);
  const handler = createVeryfrontHandler(projectDir, bootstrap.adapter, {
    projectDir,
    config: bootstrap.config,
    defaultProjectSlug: projectId,
    defaultProjectId: projectId,
    localProjects: { [projectId]: projectDir },
  });
  await handler.ready;
  setServerInitialized(true);

  return {
    handle: handler,
    teardown: async () => {
      setServerInitialized(false);
      await bootstrap.dispose?.();
    },
  };
}

async function buildDevPipeline(
  context: TestContext,
  adapter: RuntimeAdapter,
): Promise<PipelineHandle> {
  const { projectDir, projectId } = context;
  const bootstrap = await bootstrapDev(projectDir, adapter);
  const requestHandler = new RequestHandler(
    projectDir,
    bootstrap.adapter,
    () => true,
    bootstrap.config,
    projectId,
    projectId,
    { [projectId]: projectDir },
  );

  // The dev server executes its request handler behind the same middleware
  // pipeline (request-id stamping, optional CORS); mirror that here so an
  // in-process response carries what a socket response would.
  const pipeline = new MiddlewarePipeline();
  await setupMiddleware(
    pipeline,
    bootstrap.config,
    (req) => requestHandler.handleRequest(req),
  );

  return {
    handle: (request) => pipeline.execute(request, bootstrap.adapter.env.toObject()),
    teardown: async () => {
      await pipeline.teardown();
      await bootstrap.dispose?.();
    },
  };
}

/**
 * Build a project in a temp directory and run `fn` against its request pipeline.
 */
export async function withInProcessProject<T>(
  name: string,
  options: InProcessProjectOptions,
  fn: (project: InProcessProject) => Promise<T>,
): Promise<T> {
  const mode = options.mode ?? "dev";

  return await withTestContext(name, async (context) => {
    if (options.config) {
      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default ${JSON.stringify(options.config, null, 2)};\n`,
      );
    }
    if (options.files) await writeProjectFiles(context.projectDir, options.files);

    const adapter = await runtime.get();
    const peerRuntime = peerRuntimeFor(adapter);
    const closeMessageChannels = trackMessageChannels();
    let pipeline: PipelineHandle;
    try {
      pipeline = mode === "production"
        ? await buildProductionPipeline(context, adapter)
        : await buildDevPipeline(context, adapter);
    } catch (error) {
      closeMessageChannels();
      throw error;
    }

    try {
      return await fn({
        projectDir: context.projectDir,
        projectId: context.projectId,
        mode,
        context,
        async handle(request, init) {
          const req = toRequest(request, init);
          recordRequestPeerFromTransport(req, {
            runtime: peerRuntime,
            transport: "tcp",
            hostname: "127.0.0.1",
          });
          const response = await pipeline.handle(req);
          return req.method.toUpperCase() === "HEAD" ? stripHeadBody(response) : response;
        },
      });
    } finally {
      await pipeline.teardown();
      closeMessageChannels();
    }
  });
}
