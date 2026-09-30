import { isAbsolute } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  type ExecutorHttpApplicationConfiguration,
  snapshotExecutorHttpApplicationConfiguration,
} from "./application-configuration.ts";
import type { ExecutorHttpRuntime } from "#veryfront/agent/hosted/executor-runtime-entrypoint.ts";
import {
  type ExecutorHttpInstall,
  getExecutorHttpInstallSchema,
  parseExecutorInstallation,
} from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  getExecutorHttpTraceScope,
  runWithExecutorHttpTraceScope,
} from "#veryfront/observability/tracing/executor-http-trace-scope.ts";
import {
  getProjectTraceProvider,
  runWithProjectTraceProvider,
} from "#veryfront/observability/tracing/project-trace-scope.ts";
import { completeOnResponseBodyConsumption } from "#veryfront/platform/compat/http/response-lifecycle.ts";
import { inheritRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { runWithTrustedProjectEnv } from "../project-env/storage.ts";
import { snapshotInstalledProjectHttpBinding } from "../runtime-handler/installed-project.ts";

export {
  type ExecutorHttpApplicationConfiguration,
  getExecutorHttpApplicationConfigurationSchema,
} from "./application-configuration.ts";

export interface ExecutorHttpApplicationOptions {
  installation: ExecutorHttpInstall;
  /** Fixed artifact root supplied by the existing runtime installation gate. */
  projectDir: string;
  signal: AbortSignal;
  /** Project-authorized snapshot, never a process environment or request-header map. */
  configuration: ExecutorHttpApplicationConfiguration;
}

/**
 * Image-owned application factory for startExecutorRuntimeEntrypoint's HTTP hook.
 * Call only after its owner/source gate succeeds, inside the isolated process.
 * The installation owns operation settlement; the allocator owns process exit.
 * This factory retires bootstrap resources and does not itself provide a sandbox.
 */
export async function createExecutorHttpApplicationRuntime(
  options: ExecutorHttpApplicationOptions,
): Promise<ExecutorHttpRuntime> {
  const installation = parseExecutorInstallation(
    getExecutorHttpInstallSchema(),
    options.installation,
  );
  const configuration = snapshotExecutorHttpApplicationConfiguration(
    options.configuration,
    installation,
  );
  const projectDir = options.projectDir;
  if (!isAbsolute(projectDir)) throw new TypeError("Invalid installed project root");
  if (getHostEnv("PROXY_MODE") === "1") {
    throw new TypeError("Installed application factories cannot run in proxy hosts");
  }
  const binding = snapshotInstalledProjectHttpBinding({
    projectId: configuration.projectId,
    projectSlug: configuration.projectSlug,
    releaseId: configuration.releaseId,
    environmentId: configuration.environmentId,
    environmentName: configuration.environmentName,
  });
  const variables = configuration.variables;
  const run = <T>(operation: () => T): T => runWithTrustedProjectEnv(variables, binding, operation);
  const signal = options.signal;
  signal.throwIfAborted();

  // Framework loading is lazy; no application bootstrap precedes validation.
  const [{ NodeAdapter }, { bootstrapProd }, { createVeryfrontHandler }] = await Promise.all([
    import("#veryfront/platform/adapters/runtime/node/adapter.ts"),
    import("../bootstrap.ts"),
    import("../runtime-handler/index.ts"),
  ]);
  signal.throwIfAborted();
  const adapter = new NodeAdapter();
  const bootstrap = await run(() =>
    bootstrapProd(projectDir, adapter, {
      fixedProjectSource: true,
    })
  );
  try {
    signal.throwIfAborted();
    const handler = run(() =>
      createVeryfrontHandler(projectDir, bootstrap.adapter, {
        projectDir,
        config: bootstrap.config,
        installedProject: binding,
        defaultEnvironment: "production",
        allowHostProjectCodeExecution: true,
      })
    );
    await handler.ready;
    signal.throwIfAborted();
    const lifetime = new AbortController();
    const retired = Promise.withResolvers<void>();
    void retired.promise.catch(() => {});
    let closed = false;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      closed = true;
      closing = Promise.resolve().then(async () => {
        lifetime.abort(new Error("Installed application closed"));
        try {
          await run(() => bootstrap.dispose?.());
        } finally {
          await adapter.shutdown();
        }
      });
      void closing.then(retired.resolve, retired.reject);
      return closing;
    };
    return {
      settled: retired.promise,
      close,
      async handle(request) {
        if (closed) throw new Error("Installed application closed");
        const requestSignal = AbortSignal.any([request.signal, signal, lifetime.signal]);
        requestSignal.throwIfAborted();
        const traceScope = getExecutorHttpTraceScope();
        const provider = traceScope?.projectId === binding.projectId &&
            traceScope.environmentId === binding.environmentId &&
            traceScope.provider === getProjectTraceProvider()
          ? traceScope.provider
          : undefined;
        const traceContext = provider?.getContextAPI().active();
        const runRequest = run(() =>
          runWithProjectTraceProvider(provider, () =>
            runWithExecutorHttpTraceScope(binding, () => {
              const capture = () => {
                const invoke = AsyncLocalStorage.snapshot();
                return <T>(operation: () => T): T => invoke(operation);
              };
              return provider ? provider.getContextAPI().with(traceContext, capture) : capture();
            }))
        );
        const incoming = bindApplicationRequest(request, requestSignal, runRequest);
        try {
          const response = await runRequest(() => handler(incoming.request));
          return completeOnResponseBodyConsumption(response, incoming.cancel, requestSignal, {
            highWaterMark: 0,
          }, { runDeferredOperation: runRequest, errorOnAbort: true, cancellationTimeoutMs: 1000 });
        } catch (error) {
          incoming.cancel();
          throw error;
        }
      },
    };
  } catch (error) {
    try {
      await run(() => bootstrap.dispose?.());
    } finally {
      await adapter.shutdown();
    }
    throw error;
  }
}

/** Bind upload delivery to the application without extending its scope into host response consumers. */
function bindApplicationRequest(
  request: Request,
  signal: AbortSignal,
  run: <T>(operation: () => T) => T,
): { request: Request; cancel(): void } {
  const reader = request.body?.getReader();
  let finished = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const release = () => {
    finished = true;
    signal.removeEventListener("abort", abort);
    reader?.releaseLock();
  };
  const cancel = () => {
    if (finished || !reader) return;
    finished = true;
    signal.removeEventListener("abort", abort);
    void run(() => reader.cancel(signal.reason)).catch(() => {}).finally(() =>
      reader.releaseLock()
    );
  };
  const abort = () => {
    if (finished) return;
    controller?.error(signal.reason);
    cancel();
  };
  const body = reader
    ? new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      pull(target) {
        return run(async () => {
          try {
            const next = await reader.read();
            if (finished) return;
            if (next.done) {
              release();
              target.close();
            } else target.enqueue(next.value);
          } catch (error) {
            if (finished) return;
            release();
            target.error(error);
          }
        });
      },
      cancel,
    }, { highWaterMark: 0 })
    : undefined;
  const init: RequestInit & { duplex?: "half" } = {
    signal,
    ...(body ? { body, duplex: "half" as const } : {}),
  };
  try {
    const bound = inheritRequestPeerProvenance(request, new Request(request, init));
    if (reader) {
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }
    return { request: bound, cancel };
  } catch (error) {
    cancel();
    throw error;
  }
}
