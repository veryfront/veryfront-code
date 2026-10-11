import type { ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import {
  getExecutorHttpInstallSchema,
  parseExecutorInstallation,
} from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import type { HostedExecutorSession } from "#veryfront/agent/hosted/executor-session.ts";
import type { HostedExecutorSessionPool } from "#veryfront/agent/hosted/executor-session-pool.ts";
import {
  getHostedExecutorAllocationRequestSchema,
  getHostedExecutorAllocationSchema,
  parseHostedExecutorData,
  sameHostedExecutorBinding,
  sameHostedExecutorOwner,
} from "#veryfront/agent/hosted/executor-session-schema.ts";
import { verifyHostedRuntimeSourceBinding } from "#veryfront/agent/hosted/runtime-source-binding.ts";
import { normalizeDynamicDenyHeaders } from "#veryfront/security/http/application-request.ts";
import { completeOnResponseBodyConsumption } from "#veryfront/platform/compat/http/response-lifecycle.ts";
import type { RenderGenerationExecutor } from "#veryfront/rendering/render-generation.ts";
import { awaitAbortable } from "#veryfront/utils/abort.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import {
  createExecutorHttpConfigurationOperation,
  snapshotExecutorHttpApplicationConfiguration,
} from "./application-configuration.ts";
import { createExecutorHttpClient, type ExecutorHttpTracing } from "./executor-http.ts";
import type { HostedHttpInput } from "./hosted-http-broker.ts";

/** Bound on the allocator read that confirms an earlier unacknowledged release. */
const RELEASE_CONFIRMATION_TIMEOUT_MS = 5_000;

/** Validate and detach execution authority before opening a project telemetry scope. */
export function prepareHostedHttpInput(input: HostedHttpInput) {
  const allocation = parseHostedExecutorData(
    getHostedExecutorAllocationRequestSchema(),
    input.session.request,
  );
  if (allocation.executionProfile !== undefined && allocation.executionProfile !== "http") {
    throw new TypeError("HTTP executor requires the HTTP allocation profile");
  }
  allocation.executionProfile = "http";
  const installation = parseExecutorInstallation(getExecutorHttpInstallSchema(), {
    ...input.installation,
    // Validate before reserving capacity. The authenticated allocator's
    // actual generation replaces this validation-only value below.
    binding: {
      allocationId: allocation.allocationId,
      invocationId: allocation.invocationId,
      generation: 1,
    },
  });
  if (
    !sameHostedExecutorOwner(allocation.owner, installation.owner) ||
    verifyHostedRuntimeSourceBinding(allocation.source, installation.source) !== undefined
  ) {
    throw new TypeError("HTTP executor installation does not match its allocation");
  }
  const configuration = input.configuration === undefined
    ? undefined
    : snapshotExecutorHttpApplicationConfiguration(input.configuration, installation);
  const headerOptions = { denyHeaders: input.headers?.denyHeaders?.slice() };
  const tracing = input.tracing ? { ...input.tracing } : undefined;
  return {
    allocation,
    installation,
    configuration,
    headerOptions,
    tracing,
    session: { ...input.session },
  };
}

export type PreparedHostedHttpInput = ReturnType<typeof prepareHostedHttpInput>;

/** Per-request data the broker attaches to each request it admits to a generation. */
export interface HostedHttpGenerationRequest {
  /** `hostedHttpInstallationKey` of the request's own prepared input. */
  key: string;
  tracing?: ExecutorHttpTracing;
}

export interface HostedHttpGenerationExecutorOptions {
  /** Prepared input of the request that created this generation. It fixes the installation. */
  input: PreparedHostedHttpInput;
  /** Process admission for the one allocator session this executor opens. */
  sessions: Pick<HostedExecutorSessionPool, "start">;
  /** Look up the broker's data for an admitted request. */
  context(request: Request): HostedHttpGenerationRequest | undefined;
  /** Stop admitting requests after this long without one in flight. */
  idleTimeoutMs: number;
  /** Stop admitting requests this long before the allocation's hard deadline. */
  retireBeforeDeadlineMs: number;
}

export interface HostedHttpGenerationExecutor extends RenderGenerationExecutor {
  /**
   * Resolves once this executor admits no further request: its session ended, it was
   * idle, its allocation approaches its hard deadline, or stop was called. Requests
   * already admitted continue until the owner stops the executor.
   */
  readonly ended: Promise<void>;
}

/**
 * Identity of everything one executor installs: installation, image, allocation owner and
 * source, application configuration and header policy. Two inputs share an executor only
 * when these keys are equal. The key holds configuration values; keep it in memory only.
 */
export function hostedHttpInstallationKey(input: PreparedHostedHttpInput): string {
  return JSON.stringify([
    input.installation.version,
    input.installation.mode,
    input.installation.owner,
    input.installation.source,
    input.installation.root,
    input.installation.environmentId,
    input.installation.configurationId,
    input.session.expectedImage,
    input.allocation.owner,
    input.allocation.source,
    input.configuration ?? null,
    // Compare the policy request filtering applies; an invalid list removes every header.
    denyPolicyKey(input.headerOptions.denyHeaders),
  ]);
}

/** Locale-independent order by UTF-16 code units. */
function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function denyPolicyKey(names: readonly string[] | undefined): string[] | "deny-all" {
  const normalized = normalizeDynamicDenyHeaders(names);
  return normalized === null ? "deny-all" : [...normalized].sort(compareCodeUnits);
}

function timerDelay(value: number): number {
  return Math.min(Math.max(0, value), MAX_TIMER_DELAY_MS);
}

/**
 * Serve many HTTP requests for one installation through one long-lived allocator session.
 *
 * The session starts on the first request, not at construction. Every request must carry
 * the installation key of this executor; any other request is refused before dispatch, so
 * an executor that loaded one installation never serves another. A closed session is never
 * reopened: the owner replaces the executor. `stop()` settles only after the allocator
 * acknowledges that the allocation is released.
 */
export function createHostedHttpGenerationExecutor(
  options: HostedHttpGenerationExecutorOptions,
): HostedHttpGenerationExecutor {
  const input = options.input;
  const key = hostedHttpInstallationKey(input);
  const sessions = options.sessions;
  const contextOf = options.context;
  const idleTimeoutMs = options.idleTimeoutMs;
  const retireBeforeDeadlineMs = options.retireBeforeDeadlineMs;
  const lifetime = new AbortController();
  const ended = Promise.withResolvers<void>();
  let session: HostedExecutorSession | undefined;
  let channel: ExecutorChannel | undefined;
  let client: ReturnType<typeof createExecutorHttpClient> | undefined;
  let ready: Promise<void> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let active = 0;
  let retired = false;
  let released = false;
  let stopping: Promise<void> | undefined;
  let observation: Promise<unknown> | undefined;

  function retire(): void {
    if (retired) return;
    retired = true;
    clearTimeout(idleTimer);
    clearTimeout(deadlineTimer);
    ended.resolve();
  }

  function start(): Promise<void> {
    const allocation = input.allocation;
    const admissible = allocation.hardDeadlineAt - Date.now() - retireBeforeDeadlineMs;
    if (admissible <= 0) {
      throw new Error("HTTP executor allocation is inside its retirement window");
    }
    const owner = input.session.ownerSignal;
    const started = sessions.start({
      ...input.session,
      request: allocation,
      ownerSignal: owner ? AbortSignal.any([lifetime.signal, owner]) : lifetime.signal,
      createOperations(binding) {
        client = createExecutorHttpClient({
          binding: {
            allocationId: binding.allocationId,
            invocationId: binding.invocationId,
            generation: binding.generation,
          },
          channel: () => {
            if (!channel) throw new Error("HTTP executor channel is not ready");
            return channel;
          },
          ...input.headerOptions,
        });
        const operations = new Map(client.operations);
        if (input.configuration) {
          operations.set(
            "http.configuration",
            createExecutorHttpConfigurationOperation(binding, input.configuration),
          );
        }
        return { operations, revoke: () => lifetime.abort() };
      },
    });
    session = started;
    // A stopped session never serves again, whatever stopped it.
    if (started.signal.aborted) retire();
    else started.signal.addEventListener("abort", retire, { once: true });
    deadlineTimer = setTimeout(
      retire,
      timerDelay(admissible),
    );
    return (async () => {
      channel = await started.ready;
      const binding = started.binding;
      if (!binding || !client) throw new Error("HTTP executor allocation is not bound");
      const acknowledged = await channel.request("runtime.install", {
        ...input.installation,
        binding: {
          allocationId: binding.allocationId,
          invocationId: binding.invocationId,
          generation: binding.generation,
        },
      }, { signal: started.signal });
      if (
        !acknowledged || typeof acknowledged !== "object" || Array.isArray(acknowledged) ||
        Object.keys(acknowledged).length !== 1 || acknowledged.installed !== true
      ) {
        throw new Error("HTTP executor installation acknowledgement is invalid");
      }
      // The generation, not any one request, owns the installed executor.
      started.accept({ kind: "execution", signal: lifetime.signal });
    })();
  }

  function finishRequest(): void {
    active--;
    if (active === 0 && !retired) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(retire, idleTimeoutMs);
    }
  }

  async function confirmRelease(): Promise<void> {
    if (!session) {
      lifetime.abort();
      return;
    }
    // Requests still in flight here were cut short by a forced stop.
    const result = await session.close(active > 0 ? "canceled" : "completed");
    lifetime.abort();
    if (result.release !== "reaper-required") return;
    // The session's bounded release attempt was not acknowledged. Ask the allocator.
    const binding = session.binding;
    if (binding) {
      try {
        // The client may keep raw work pending after cancellation. Bound each wait, and
        // reuse a still-pending observation instead of starting another one.
        const signal = AbortSignal.timeout(RELEASE_CONFIRMATION_TIMEOUT_MS);
        if (!observation) {
          const pending = input.session.allocator.observe(binding, signal);
          observation = pending;
          pending.then(() => {
            if (observation === pending) observation = undefined;
          }, () => {
            if (observation === pending) observation = undefined;
          });
        }
        const view = parseHostedExecutorData(
          getHostedExecutorAllocationSchema(),
          await awaitAbortable(observation, signal),
        );
        if (sameHostedExecutorBinding(view.binding, binding) && view.phase === "released") return;
      } catch { /* Reported below as an unconfirmed release. */ }
    }
    throw new Error("HTTP executor release is unconfirmed");
  }

  // A generation that is never used retires like an idle one.
  idleTimer = setTimeout(retire, idleTimeoutMs);

  return {
    ended: ended.promise,
    async render(request: Request): Promise<Response> {
      const context = contextOf(request);
      if (context?.key !== key) {
        throw new TypeError("HTTP executor generation is bound to another installation");
      }
      if (retired) throw new Error("HTTP executor generation is retired");
      request.signal.throwIfAborted();
      if (!ready) {
        // A failed start, including refused admission, retires this executor.
        ready = Promise.resolve().then(start);
        ready.catch(retire);
      }
      active++;
      clearTimeout(idleTimer);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        finishRequest();
      };
      try {
        await awaitAbortable(ready, request.signal);
        const current = session!;
        const signal = AbortSignal.any([request.signal, current.signal, lifetime.signal]);
        const owned = new Request(request, { signal });
        const response = await current.runOwned(() => client!.fetch(owned, context.tracing));
        return completeOnResponseBodyConsumption(
          response,
          finish,
          signal,
          { highWaterMark: 0 },
          { errorOnAbort: true },
        );
      } catch (error) {
        finish();
        throw error;
      }
    },
    stop(): Promise<void> {
      retire();
      if (released) return Promise.resolve();
      stopping ??= confirmRelease().then(() => {
        released = true;
      }).finally(() => {
        stopping = undefined;
      });
      return stopping;
    },
  };
}
