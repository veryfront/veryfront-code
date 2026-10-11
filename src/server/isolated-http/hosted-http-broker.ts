import type { ProjectTraceConfigResult } from "#veryfront/server/project-env/telemetry-config.ts";
import { runProjectHttpTracing } from "#veryfront/observability/tracing/project-http-tracing.ts";
import { getProjectTraceProvider } from "#veryfront/observability/tracing/project-trace-scope.ts";
import { publicTrace } from "#veryfront/observability/tracing/api-shim.ts";
import {
  formatTraceparent,
  parseTraceparent,
} from "#veryfront/observability/tracing/traceparent.ts";
import type { ExecutorHttpInstall } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import type { HostedExecutorSessionOptions } from "#veryfront/agent/hosted/executor-session.ts";
import {
  createHostedExecutorSessionPool,
  type HostedExecutorSessionPoolOptions,
} from "#veryfront/agent/hosted/executor-session-pool.ts";
import type { ApplicationRequestHeaderOptions } from "#veryfront/security/http/application-request.ts";
import { RenderGeneration } from "#veryfront/rendering/render-generation.ts";
import { RenderGenerationPool } from "#veryfront/rendering/render-generation-pool.ts";
import { resolveRenderGenerationIdentity } from "#veryfront/rendering/render-generation-binding.ts";
import type { WorkerGenerationIdentity } from "#veryfront/security/sandbox/worker-generation.ts";
import type { ExecutorHttpTracing } from "./executor-http.ts";
import type { ExecutorHttpApplicationConfiguration } from "./application-configuration.ts";
import {
  createHostedHttpGenerationExecutor,
  type HostedHttpGenerationRequest,
  hostedHttpInstallationKey,
  type PreparedHostedHttpInput,
  prepareHostedHttpInput,
} from "./generation-executor.ts";
import { buildHostedHttpGenerationBindingInput } from "./hosted-http-resolver.ts";

export { createHostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-allocator-client.ts";
export {
  connectExecutorTransport,
  type ConnectExecutorTransportOptions,
} from "#veryfront/agent/hosted/executor-node-transport.ts";

/**
 * Trusted ingress authority; none of these values are inferred from HTTP headers or URLs.
 * `projectTracing` binds collector settings to the installed project/environment and imports
 * executor spans under the broker's request parent. Collector credentials stay on the broker.
 */
export interface HostedHttpInput {
  session: Omit<HostedExecutorSessionOptions, "createOperations" | "preparationSignal">;
  installation: Omit<ExecutorHttpInstall, "binding">;
  /** Project-authorized snapshot for the built-in application runtime; collector settings are refused. */
  configuration?: ExecutorHttpApplicationConfiguration;
  headers?: ApplicationRequestHeaderOptions;
  tracing?: ExecutorHttpTracing;
  /**
   * Authenticated project exporter settings, retained on the broker.
   * The enabled project/environment must match the installation. Returned executor
   * spans use this request's provider and parent until its response body settles.
   * Mutually exclusive with tracing; omission preserves explicit tracing behavior.
   */
  projectTracing?: ProjectTraceConfigResult;
}

/** Admission and lifetime limits of the hosted HTTP broker's warm executors. */
export interface HostedHttpBrokerOptions extends HostedExecutorSessionPoolOptions {
  /** Requests one executor serves at once. Default 8, maximum 16. */
  maxConcurrentRequestsPerExecutor?: number;
  /** Retire an executor after this long without a request in flight. Default 60 seconds, maximum 1 hour. */
  idleTimeoutMs?: number;
  /**
   * How long a retiring executor keeps serving requests it already admitted. Executors also
   * stop admitting requests this long before their allocation's hard deadline. Default 10
   * seconds, maximum 5 minutes.
   */
  drainTimeoutMs?: number;
  /** Operator execution-policy revision bound into every generation identity. */
  executionPolicyId?: string;
}

/** Upper bound on the delay between retries of an unconfirmed retirement. */
const MAX_RETIREMENT_RETRY_MS = 60_000;

function bounded(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`Hosted HTTP broker requires a bounded ${name}`);
  }
  return value;
}

/**
 * Serve HTTP requests from warm executors with no shared-host fallback. Each executor holds
 * one long-lived allocator session for one installation and is keyed by the render generation
 * identity of its project, environment, digest-pinned image, configuration and execution
 * policy. When a project environment resolves to a new generation, its previous generation
 * stops admitting requests and drains. A request whose installation differs from the warm
 * executor with the same identity is refused, never rebound.
 */
export function createHostedHttpBroker(options: HostedHttpBrokerOptions) {
  const sessions = createHostedExecutorSessionPool(options);
  const perExecutor = bounded(
    options.maxConcurrentRequestsPerExecutor ?? 8,
    1,
    16,
    "per-executor request limit",
  );
  const idleTimeoutMs = bounded(options.idleTimeoutMs ?? 60_000, 1, 3_600_000, "idle timeout");
  const drainTimeoutMs = bounded(options.drainTimeoutMs ?? 10_000, 0, 300_000, "drain timeout");
  const executionPolicyId = options.executionPolicyId ?? "hosted-http:v1";
  if (
    typeof executionPolicyId !== "string" || !executionPolicyId || executionPolicyId.length > 256
  ) throw new TypeError("Hosted HTTP broker requires an execution policy identity");
  const generations = new RenderGenerationPool({
    maxGenerations: options.maxActive,
    maxConcurrentRenders: options.maxActive * perExecutor,
  });
  const contexts = new WeakMap<Request, HostedHttpGenerationRequest>();
  /** Current pool key of each project environment's generation. */
  const scopes = new Map<string, Readonly<WorkerGenerationIdentity>>();
  /** Generations whose executor was constructed. */
  const constructed = new Set<string>();
  /** Pending retries of retirements whose release was not confirmed. */
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  let epoch = 0;
  let stopped = false;

  function retire(key: Readonly<WorkerGenerationIdentity>, retryDelayMs = 1_000): void {
    if (scopes.get(key.scopeId)?.generationId === key.generationId) scopes.delete(key.scopeId);
    void generations.retire(key).then(() => {
      constructed.delete(key.generationId);
    }, () => {
      // An unconfirmed release keeps the generation's capacity reserved. Retry until the
      // allocator confirms it; shutdown retries every remaining generation itself.
      if (stopped || retries.has(key.generationId)) return;
      retries.set(
        key.generationId,
        setTimeout(() => {
          retries.delete(key.generationId);
          retire(key, Math.min(retryDelayMs * 2, MAX_RETIREMENT_RETRY_MS));
        }, retryDelayMs),
      );
    });
  }

  function currentKey(identity: Readonly<WorkerGenerationIdentity>) {
    const current = scopes.get(identity.scopeId);
    if (current?.generationId.startsWith(`${identity.generationId}:`)) return current;
    // A new generation for this environment: drain the previous one.
    if (current) retire(current);
    const key = Object.freeze({
      scopeId: identity.scopeId,
      generationId: `${identity.generationId}:${++epoch}`,
    });
    scopes.set(key.scopeId, key);
    return key;
  }

  async function dispatch(
    request: Request,
    input: PreparedHostedHttpInput,
    identity: Readonly<WorkerGenerationIdentity>,
    tracing = input.tracing,
  ): Promise<Response> {
    request.signal.throwIfAborted();
    const key = currentKey(identity);
    const admitted = new Request(request, { signal: request.signal });
    contexts.set(admitted, { key: hostedHttpInstallationKey(input), tracing });
    try {
      return await generations.render(admitted, key, create);
    } catch (error) {
      // A generation that was never constructed has no executor to retire it later.
      if (
        !constructed.has(key.generationId) &&
        scopes.get(key.scopeId)?.generationId === key.generationId
      ) scopes.delete(key.scopeId);
      throw error;
    }

    function create(owned: Readonly<WorkerGenerationIdentity>) {
      constructed.add(owned.generationId);
      const executor = createHostedHttpGenerationExecutor({
        input,
        sessions,
        context: (value) => contexts.get(value),
        idleTimeoutMs,
        retireBeforeDeadlineMs: drainTimeoutMs,
      });
      void executor.ended.then(() => retire(owned));
      return new RenderGeneration({
        executor,
        // Executor images own their artifacts; the allocator release retires them.
        releaseArtifacts: () => Promise.resolve(),
        maxConcurrentRenders: perExecutor,
        drainTimeoutMs,
      });
    }
  }

  function shutdown() {
    stopped = true;
    for (const timer of retries.values()) clearTimeout(timer);
    retries.clear();
    // Session shutdown cancels every allocation now; generation cleanup then confirms it.
    const result = sessions.shutdown();
    void generations.close().catch(() => {});
    return result;
  }
  // An owner signal shuts down the session pool directly; stop retries and generations too.
  options.signal?.addEventListener("abort", shutdown, { once: true });
  if (options.signal?.aborted) shutdown();

  return {
    get active() {
      return sessions.active;
    },
    /** Project environments with a generation that admits requests. */
    get generations() {
      return scopes.size;
    },
    get settled() {
      return sessions.settled;
    },
    shutdown,
    async fetch(request: Request, input: HostedHttpInput): Promise<Response> {
      request.signal.throwIfAborted();
      const prepared = prepareHostedHttpInput(input);
      const settings = input.projectTracing;
      if (settings !== undefined && input.tracing !== undefined) {
        throw new TypeError("Project tracing cannot be combined with explicit tracing");
      }
      const owner = prepared.installation.owner;
      const identity = {
        projectId: owner.scopeKind === "project" ? owner.projectId : undefined,
        environmentId: prepared.installation.environmentId,
      };
      if (
        settings?.status === "enabled" && (
          settings.config.projectId !== identity.projectId ||
          settings.config.environmentId !== identity.environmentId
        )
      ) throw new TypeError("HTTP executor tracing identity does not match its installation");
      const generation = await resolveGenerationIdentity(prepared, executionPolicyId);
      if (settings === undefined) return dispatch(request, prepared, generation);
      return runProjectHttpTracing(
        settings,
        identity,
        request,
        () => dispatch(request, prepared, generation, captureProjectTracing()),
        { errorOnAbort: true },
      );
    },
  };
}

/**
 * The digest-pinned tenant-source image contains the dependencies, prepared artifact,
 * framework and runtime, so its digest identifies each of them.
 */
function resolveGenerationIdentity(input: PreparedHostedHttpInput, executionPolicyId: string) {
  const authorized = buildHostedHttpGenerationBindingInput({
    session: { ...input.session, request: input.allocation },
    installation: input.installation,
  });
  const image = authorized.sourceSnapshotId;
  return resolveRenderGenerationIdentity({
    projectId: authorized.projectId,
    environmentId: authorized.environmentId,
    sourceSnapshotId: image,
    configurationId: authorized.configurationId,
    dependencySnapshotId: image,
    artifactId: image,
    frameworkId: image,
    runtimeId: image,
    executionPolicyId,
  });
}

/** Capture this request's provider and parent before asynchronous executor delivery. */
function captureProjectTracing(): ExecutorHttpTracing | undefined {
  try {
    const provider = getProjectTraceProvider();
    if (!provider?.importSpans) return undefined;
    const traceparent = formatTraceparent(publicTrace.getActiveSpan()?.spanContext());
    const parent = parseTraceparent(traceparent);
    if (!traceparent || !parent) return undefined;
    const importSpans = provider.importSpans.bind(provider);
    return { traceparent, onRecords: (records) => importSpans(records, parent) };
  } catch {
    // Exporter failures must not change application responses.
    return undefined;
  }
}

export type {
  HostedHttpIngressOptions,
  HostedHttpRequestAuthority,
} from "./hosted-http-ingress.ts";
