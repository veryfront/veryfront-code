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
import { SERVICE_OVERLOADED } from "#veryfront/errors";
import { serverLogger as logger } from "#veryfront/utils";
import { completeOnResponseBodyConsumption } from "#veryfront/platform/compat/http/response-lifecycle.ts";
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
  /**
   * Warm executors one project may hold at once, counting any whose release is not yet
   * confirmed. At the bound the project's least recently used idle executor is retired
   * first; when all of them are serving requests, the request is refused. Default 4, or
   * `maxActive` when that is smaller.
   */
  maxWarmGenerationsPerProject?: number;
  /** @internal Environments whose generation order is remembered; lowered in hermetic tests. */
  maxTrackedEnvironments?: number;
}

/** Environments whose generation order the broker remembers. */
const MAX_TRACKED_ENVIRONMENTS = 4096;
/** Cold requests that wait for one idle executor to be retired before they are refused. */
const MAX_ROOM_ATTEMPTS = 2;

/** One warm executor's slot, from reservation until the allocator confirms its release. */
interface WarmGeneration {
  readonly key: Readonly<WorkerGenerationIdentity>;
  readonly projectId: string;
  /** Requests admitted to it whose response has not settled. */
  active: number;
  /** Logical time of its latest admission or completion. */
  usedAt: number;
  retiring: boolean;
}

function exhausted(): Error {
  return SERVICE_OVERLOADED.create({ detail: "Hosted HTTP executor capacity is exhausted" });
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
  const maxActive = options.maxActive;
  const perProject = bounded(
    options.maxWarmGenerationsPerProject ?? Math.min(4, maxActive),
    1,
    maxActive,
    "per-project generation limit",
  );
  const maxTracked = bounded(
    options.maxTrackedEnvironments ?? MAX_TRACKED_ENVIRONMENTS,
    1,
    MAX_TRACKED_ENVIRONMENTS,
    "tracked environment limit",
  );
  const generations = new RenderGenerationPool({
    maxGenerations: maxActive,
    maxConcurrentRenders: maxActive * perExecutor,
  });
  const contexts = new WeakMap<Request, HostedHttpGenerationRequest>();
  /** Current pool key of each project environment's generation. */
  const scopes = new Map<string, Readonly<WorkerGenerationIdentity>>();
  /**
   * Latest admitted generation of each environment and when its newest request began
   * authorization. Kept after the generation retires, up to a bounded number of environments.
   */
  const watermarks = new Map<string, { generationId: string; at: number }>();
  /** Generations whose executor was constructed. */
  const constructed = new Set<string>();
  /** Every slot in use, by generation, including ones still releasing. */
  const warm = new Map<string, WarmGeneration>();
  /** Idle executors being retired to make room, so concurrent cold requests share one. */
  const evictions = new Map<string, Promise<void>>();
  /** Pending retries of retirements whose release was not confirmed. */
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  /** Newest authorization time among environments no longer tracked in `watermarks`. */
  let untrackedBefore = Number.NEGATIVE_INFINITY;
  let epoch = 0;
  let clock = 0;
  let stopped = false;

  /** One retirement attempt. Rejects while the allocator has not confirmed the release. */
  function release(key: Readonly<WorkerGenerationIdentity>): Promise<void> {
    forget(key);
    const slot = warm.get(key.generationId);
    if (slot) slot.retiring = true;
    return generations.retire(key).then(() => {
      constructed.delete(key.generationId);
      warm.delete(key.generationId);
    });
  }

  function retryLater(key: Readonly<WorkerGenerationIdentity>, retryDelayMs: number): void {
    if (stopped || retries.has(key.generationId)) return;
    retries.set(
      key.generationId,
      setTimeout(() => {
        retries.delete(key.generationId);
        retire(key, Math.min(retryDelayMs * 2, MAX_RETIREMENT_RETRY_MS));
      }, retryDelayMs),
    );
  }

  function retire(key: Readonly<WorkerGenerationIdentity>, retryDelayMs = 1_000): void {
    // An unconfirmed release keeps the generation's capacity reserved. Retry until the
    // allocator confirms it; shutdown retries every remaining generation itself.
    void release(key).catch(() => retryLater(key, retryDelayMs));
  }

  function forget(key: Readonly<WorkerGenerationIdentity>): void {
    if (scopes.get(key.scopeId)?.generationId !== key.generationId) return;
    scopes.delete(key.scopeId);
  }

  /** Retire one idle executor and settle once its release is confirmed. */
  function evict(slot: WarmGeneration): Promise<void> {
    const id = slot.key.generationId;
    const pending = evictions.get(id);
    if (pending) return pending;
    const eviction = release(slot.key).then(() => {
      evictions.delete(id);
    }, (error) => {
      // The slot stays reserved; the usual retry confirms the release later.
      evictions.delete(id);
      retryLater(slot.key, 1_000);
      throw error;
    });
    evictions.set(id, eviction);
    return eviction;
  }

  /**
   * Make room for one new generation of `projectId`. Returns nothing when a slot is free,
   * or the retirement to wait for. Only an executor with no request in flight is retired:
   * the project's own when the project is at its bound, otherwise the least recently used
   * of any project. Throws when every candidate is serving requests.
   */
  function makeRoom(
    projectId: string,
    replaced: Readonly<WorkerGenerationIdentity> | undefined,
  ): Promise<void> | undefined {
    let ofProject = 0;
    for (const slot of warm.values()) if (slot.projectId === projectId) ofProject++;
    const projectFull = ofProject >= perProject;
    if (!projectFull && warm.size < maxActive) return undefined;
    // Share a retirement already under way rather than retiring a second executor.
    for (const [id, eviction] of evictions) {
      if (!projectFull || warm.get(id)?.projectId === projectId) return eviction;
    }
    const idle = (slot: WarmGeneration | undefined): slot is WarmGeneration =>
      slot !== undefined && !slot.retiring && slot.active === 0 &&
      (!projectFull || slot.projectId === projectId);
    // The environment's previous generation is retired anyway; reuse its slot first.
    let candidate = replaced ? warm.get(replaced.generationId) : undefined;
    if (!idle(candidate)) {
      candidate = undefined;
      for (const slot of warm.values()) {
        if (idle(slot) && (!candidate || slot.usedAt < candidate.usedAt)) candidate = slot;
      }
    }
    if (!candidate) throw exhausted();
    return evict(candidate);
  }

  /** Refuse a request that cannot be ordered after its environment's latest generation. */
  function order(identity: Readonly<WorkerGenerationIdentity>, requestedAt: number): void {
    const mark = watermarks.get(identity.scopeId);
    const same = mark?.generationId === identity.generationId;
    // Resolutions can complete out of order during a release change. A request whose
    // authorization did not begin strictly after the latest admitted generation's newest
    // request must not replace that generation, even after it retired. An environment
    // that is no longer tracked keeps the rule through the newest time that was dropped.
    if (mark ? !same && requestedAt <= mark.at : requestedAt <= untrackedBefore) {
      throw SERVICE_OVERLOADED.create({
        detail: "A newer generation serves this project environment",
      });
    }
    watermarks.delete(identity.scopeId);
    watermarks.set(identity.scopeId, {
      generationId: identity.generationId,
      at: mark && same ? Math.max(mark.at, requestedAt) : requestedAt,
    });
    if (watermarks.size > maxTracked) {
      const oldest = watermarks.keys().next().value!;
      untrackedBefore = Math.max(untrackedBefore, watermarks.get(oldest)!.at);
      watermarks.delete(oldest);
    }
  }

  async function currentKey(
    identity: Readonly<WorkerGenerationIdentity>,
    requestedAt: number,
    projectId: string,
  ) {
    for (let attempt = 0;; attempt++) {
      order(identity, requestedAt);
      const current = scopes.get(identity.scopeId);
      if (current?.generationId.startsWith(`${identity.generationId}:`)) return current;
      const room = makeRoom(projectId, current);
      if (room) {
        if (attempt >= MAX_ROOM_ATTEMPTS) throw exhausted();
        try {
          await room;
        } catch {
          // The release was not confirmed in time. Its slot stays reserved.
          throw exhausted();
        }
        continue;
      }
      // A new generation for this environment: drain the previous one.
      if (current) retire(current);
      const key = Object.freeze({
        scopeId: identity.scopeId,
        generationId: `${identity.generationId}:${++epoch}`,
      });
      scopes.set(key.scopeId, key);
      warm.set(key.generationId, {
        key,
        projectId,
        active: 0,
        usedAt: ++clock,
        retiring: false,
      });
      return key;
    }
  }

  async function dispatch(
    request: Request,
    input: PreparedHostedHttpInput,
    identity: Readonly<WorkerGenerationIdentity>,
    projectId: string,
    tracing = input.tracing,
  ): Promise<Response> {
    // Each caller's owner signal bounds its own request, also on a warm executor.
    const owner = input.session.ownerSignal;
    const signal = owner ? AbortSignal.any([request.signal, owner]) : request.signal;
    signal.throwIfAborted();
    const key = await currentKey(identity, input.allocation.requestedAt, projectId);
    // A request in flight keeps its executor from being retired to make room.
    const slot = warm.get(key.generationId);
    if (slot) {
      slot.active++;
      slot.usedAt = ++clock;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (!slot) return;
      slot.active--;
      slot.usedAt = ++clock;
    };
    try {
      signal.throwIfAborted();
      const admitted = new Request(request, { signal });
      contexts.set(admitted, { key: hostedHttpInstallationKey(input), tracing });
      const response = await generations.render(admitted, key, create);
      // An abort must fail an unfinished body rather than end it as if complete.
      return completeOnResponseBodyConsumption(
        response,
        finish,
        signal,
        { highWaterMark: 0 },
        { errorOnAbort: true },
      );
    } catch (error) {
      finish();
      // A generation that was never constructed has no executor to retire it later.
      // Keep its slot while another request is still starting it.
      if (!constructed.has(key.generationId) && (!slot || slot.active === 0)) {
        forget(key);
        warm.delete(key.generationId);
      }
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
    // Session shutdown cancels every allocation now and reports unreleased ones in its
    // result; generation cleanup then confirms each release. Report a cleanup that could
    // not confirm one, since no retry follows shutdown.
    const result = sessions.shutdown();
    void generations.close().catch((error) => {
      logger.warn("Hosted HTTP generation cleanup did not confirm every release", {
        unconfirmed: error instanceof AggregateError ? error.errors.length : 1,
      });
    });
    return result;
  }
  // An owner signal shuts down the session pool directly; stop retries and generations too.
  const onOwnerAbort = () => {
    void shutdown();
  };
  options.signal?.addEventListener("abort", onOwnerAbort, { once: true });
  if (options.signal?.aborted) onOwnerAbort();

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
      // The generation identity is only resolved for a project-owned installation.
      const projectId = identity.projectId;
      if (projectId === undefined) {
        throw new TypeError("HTTP executor generation requires a project owner");
      }
      if (settings === undefined) return dispatch(request, prepared, generation, projectId);
      return runProjectHttpTracing(
        settings,
        identity,
        request,
        () => dispatch(request, prepared, generation, projectId, captureProjectTracing()),
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
