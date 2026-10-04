import {
  hostedAgentPauseCapabilities as creationCapabilities,
  recordHostedAgentPausePersistence,
  registerHostedAgentPauseSettlement,
} from "./manual-pause-settlement.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { getBaseLogger } from "#veryfront/utils/logger/index.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import {
  requireHostPrivateApiHttps,
  resolveHostOwnedSourceApiBaseUrl,
} from "#veryfront/config/host-api-base.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { throwIfAborted } from "#veryfront/utils/abort.ts";
import { cancelPrivateStream, getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import { privateTextCharCodeAt, privateTextSlice } from "#veryfront/security/private-text.ts";
import {
  type AgentManualPause,
  agentManualPauseBoundary,
  type AgentPauseCheckpoint,
  getAgentPauseCheckpointSchema,
  parseAgentPauseCheckpoint,
} from "../runtime/manual-pause.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";

const getAckSchema = defineSchema((v) => v.object({ stop: v.boolean() }).strict());
const getLoadSchema = defineSchema((v) =>
  v.object({
    stop: v.boolean(),
    checkpoint: v.union([v.null(), getAgentPauseCheckpointSchema()]),
    pauseRequested: v.boolean().optional(),
  })
    .strict()
);
const credentials = createPrivateWeakStore<object, { token: string; runId: string }>();
const lifetimeBindings = createPrivateWeakStore<object, (signal: AbortSignal) => void>();
const capabilityFactories = createPrivateWeakStore<
  object,
  (signal: AbortSignal) => AgentManualPause | undefined
>();
const stoppedCapabilities = createPrivateWeakStore<object, { stopped: boolean }>();
const freeze = Object.freeze;
const timeout = AbortSignal.timeout;
const any = AbortSignal.any;
const apply = Reflect.apply;
const encode = encodeURIComponent;
const schedule = setTimeout;
const NativePromise = Promise;
const NativeTypeError = TypeError;
const responseStatus = Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!;
const responseBody = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const minimum = Math.min;
const logger = getBaseLogger("Agent pause");

function bodyOf(response: Response): ReadableStream<Uint8Array> | null {
  return apply(responseBody, response, []);
}

async function cancelResponse(response: Response): Promise<void> {
  const body = bodyOf(response);
  if (body) await cancelPrivateStream(body);
}

async function readReply(response: Response, signal: AbortSignal): Promise<unknown> {
  const body = bodyOf(response);
  const safeResponse = {
    __proto__: null,
    body: body === null ? null : {
      __proto__: null,
      getReader: () => getPrivateStreamReader(body),
    },
  };
  const reply = await readResponseTextPrefix(safeResponse, 2 * 1024 * 1024 + 4096, signal, {
    fatalUtf8: true,
  });
  if (reply.truncated) throw new NativeTypeError("Invalid agent pause acknowledgement");
  return privateJsonParse(reply.text);
}

function requestSignal(signal: AbortSignal): AbortSignal {
  const signals = [signal, apply(timeout, AbortSignal, [2000]) as AbortSignal];
  const privateSignals = createPrivateSet(signals);
  defineOwnDataProperty(signals, Symbol.iterator, () => privateSignals.values());
  return apply(any, AbortSignal, [signals]);
}

/** Construct only at trusted ingress; every closure is bound to one opaque dispatch credential. */
export function createRunBoundAgentManualPause(input: {
  apiUrl: string;
  runId: string;
  token: string;
  signal: AbortSignal | undefined;
  fetch?: typeof fetch;
}): AgentManualPause {
  const endpoint = requireHostPrivateApiHttps(input.apiUrl);
  let end = endpoint.length;
  while (end > 0 && privateTextCharCodeAt(endpoint, end - 1) === 47) end--;
  const apiUrl = privateTextSlice(endpoint, 0, end);
  const transport = input.fetch ?? createVeryfrontApiOriginBoundOutboundFetch(apiUrl);
  const token = input.token;
  let signal = input.signal;
  const lifetime = (): AbortSignal => {
    if (!signal) throw agentManualPauseBoundary();
    return signal;
  };
  const path = `${apiUrl}/runs/${encode(input.runId)}`;
  const state = { stopped: false, requiresCheckpoint: false };
  const send = async (suffix: string, body: string | undefined, onSend?: () => void) => {
    try {
      const outboundSignal = requestSignal(lifetime());
      throwIfAborted(lifetime());
      onSend?.();
      return await transport(`${path}/${suffix}`, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        signal: outboundSignal,
      });
    } catch {
      // An unknown write stays at this boundary; the retry sends identical bytes.
      return undefined;
    }
  };
  /** Settles one reply: a parsed value, undefined to retry, or a thrown boundary. */
  const settle = async <T>(
    response: Response | undefined,
    parse: (value: unknown) => T,
  ): Promise<{ value: T } | undefined> => {
    if (!response) return undefined;
    const status = apply(responseStatus, response, []) as number;
    if (status >= 200 && status < 300) {
      try {
        return { value: parse(await readReply(response, lifetime())) };
      } catch {
        // Malformed or lost replies never become permission to continue.
        return undefined;
      }
    }
    await cancelResponse(response);
    if (status < 500) {
      if (state.stopped) throw agentManualPauseBoundary();
      throw new NativeTypeError("Agent pause control request rejected");
    }
    return undefined;
  };
  const request = async <T>(
    suffix: string,
    body: string | undefined,
    parse: (value: unknown) => T,
    mayCommitPause = false,
  ): Promise<T> => {
    const checkLifetime = () => {
      if (!lifetime().aborted) return;
      if (state.stopped) throw agentManualPauseBoundary();
      throwIfAborted(lifetime());
    };
    for (let attempt = 0;; attempt++) {
      checkLifetime();
      const previouslyStopped = state.stopped;
      const response = await send(
        suffix,
        body,
        mayCommitPause
          ? () => {
            // Once dispatched, a lost reply may hide a committed checkpoint.
            state.stopped = true;
          }
          : undefined,
      );
      if (mayCommitPause && response) {
        const status = apply(responseStatus, response, []) as number;
        if (status >= 400 && status < 500) state.stopped = previouslyStopped;
      }
      const settled = await settle(response, parse);
      if (settled) return settled.value;
      checkLifetime();
      if (attempt === 2) {
        logger.warn(
          "Agent is held at a safe boundary because its pause acknowledgement is unavailable",
        );
      }
      await new NativePromise<void>((resolve) =>
        schedule(resolve, minimum(1000, 100 * 2 ** minimum(attempt, 4)))
      );
    }
  };
  const capability = freeze({
    async load() {
      const reply = await request(
        "pause-checkpoint",
        undefined,
        (value) => getLoadSchema().parse(value),
      );
      if (reply.stop) {
        state.stopped = true;
        throw agentManualPauseBoundary();
      }
      state.stopped = false;
      state.requiresCheckpoint = reply.checkpoint !== null;
      return reply.checkpoint == null ? null : parseAgentPauseCheckpoint(reply.checkpoint);
    },
    async requested() {
      const reply = await request(
        "pause-checkpoint?boundary=true",
        undefined,
        (value) => getLoadSchema().parse(value),
      );
      if (reply.stop) {
        state.stopped = true;
        throw agentManualPauseBoundary();
      }
      // Older control planes still receive the existing checkpoint acknowledgement.
      const requested = state.requiresCheckpoint || (reply.pauseRequested ?? true);
      return requested;
    },
    async release() {
      for (;;) {
        const stop =
          (await request("pause-ack", privateJsonStringify({ checkpoint: null })!, (value) =>
            getAckSchema().parse(value))).stop;
        if (!stop) {
          state.stopped = false;
          state.requiresCheckpoint = false;
          return false;
        }
        // A requested pause rejects retirement too. Keep the live invocation open
        // until its dispatch stops; it has no durable checkpoint to resume yet.
        const boundary = await request(
          "pause-checkpoint?boundary=true",
          undefined,
          (value) =>
            getLoadSchema().parse(value),
        );
        if (boundary.stop) {
          state.stopped = true;
          return true;
        }
        await new NativePromise<void>((resolve) =>
          schedule(resolve, 1000)
        );
      }
    },
    persisted(succeeded: boolean) {
      recordHostedAgentPausePersistence(capability, succeeded);
    },
    async acknowledge(checkpoint: AgentPauseCheckpoint) {
      const body = privateJsonStringify({ checkpoint: parseAgentPauseCheckpoint(checkpoint) })!;
      const stop = (await request("pause-ack", body, (value) =>
        getAckSchema().parse(value), true)).stop;
      state.stopped = stop;
      return stop;
    },
  });
  stoppedCapabilities.set(capability, state);
  if (!signal) {
    lifetimeBindings.set(capability, (executionSignal) => {
      if (signal && signal !== executionSignal) {
        throw new TypeError("Agent pause lifetime already bound");
      }
      signal = executionSignal;
    });
  }
  creationCapabilities.set(capability, capability);
  const settlementBody = privateJsonStringify({ settled: true })!;
  registerHostedAgentPauseSettlement(
    capability,
    () => state.stopped && !lifetime().aborted,
    async () => {
      const response = await send("pause-ack", settlementBody);
      if (!response) return "retry";
      const status = apply(responseStatus, response, []) as number;
      if (status >= 400 && status < 500) {
        await cancelResponse(response);
        return "rejected";
      }
      if (status < 200 || status >= 300) {
        await cancelResponse(response);
        return "retry";
      }
      try {
        return getAckSchema().parse(await readReply(response, lifetime())).stop
          ? "confirmed"
          : "rejected";
      } catch {
        return "retry";
      }
    },
  );
  return capability;
}

/** Keep the pause token out of request fields and project-visible runtime options. */
export function registerHostedAgentPauseCredential(
  request: ParsedHostedChatRequest,
  token: string | undefined,
): void {
  if (!token || token.length > 16384 || !request.projectId || !request.durableRootRun?.runId) {
    return;
  }
  credentials.set(request, { token, runId: request.durableRootRun.runId });
}

export function createHostedAgentManualPause(
  request: ParsedHostedChatRequest,
  signal: AbortSignal | undefined,
): AgentManualPause | undefined {
  const credential = credentials.get(request);
  if (!credential) return undefined;
  return createRunBoundAgentManualPause({
    apiUrl: resolveHostOwnedSourceApiBaseUrl(),
    runId: credential.runId,
    token: credential.token,
    signal,
  });
}

/** Construct host-private pause transport without a project-selected destination. */
export function createHostOwnedAgentManualPause(input: {
  runId: string;
  token: string;
  signal: AbortSignal | undefined;
}): AgentManualPause {
  return createRunBoundAgentManualPause({ ...input, apiUrl: resolveHostOwnedSourceApiBaseUrl() });
}

export function registerHostedAgentPauseCreationOptions(
  options: unknown,
  request: ParsedHostedChatRequest,
  rootContext?: unknown,
): void {
  const capability = createHostedAgentManualPause(request, undefined);
  if (capability) {
    creationCapabilities.set(requirePauseCarrier(options), capability);
    creationCapabilities.set(request, capability);
    if (rootContext) creationCapabilities.set(requirePauseCarrier(rootContext), capability);
  }
}

/** Bind a prepared credential to execution, after its admission request has ended. */
export function bindHostedAgentPauseLifetime(target: unknown, signal: AbortSignal): void {
  const capability = creationCapabilities.get(requirePauseCarrier(target));
  if (capability) lifetimeBindings.get(capability)?.(signal);
}

export function getHostedAgentPauseCreationOptions(options: unknown): AgentManualPause | undefined {
  return creationCapabilities.get(requirePauseCarrier(options));
}

/** Carry exact-dispatch stop state through host lifecycle objects without public fields. */
export function inheritHostedAgentPauseCapability(
  target: unknown,
  source: unknown,
  lifetimeSignal?: AbortSignal,
): void {
  const factory = capabilityFactories.get(requirePauseCarrier(source));
  if (factory) {
    capabilityFactories.set(
      requirePauseCarrier(target),
      lifetimeSignal
        ? (signal) => {
          const signals = [signal, lifetimeSignal];
          const privateSignals = createPrivateSet(signals);
          defineOwnDataProperty(signals, Symbol.iterator, () => privateSignals.values());
          return factory(apply(any, AbortSignal, [signals]));
        }
        : factory,
    );
  }
  const capability = creationCapabilities.get(requirePauseCarrier(source));
  if (capability) creationCapabilities.set(requirePauseCarrier(target), capability);
}

export function hasHostedAgentPauseStopped(lifecycle: unknown): boolean {
  const capability = creationCapabilities.get(requirePauseCarrier(lifecycle));
  return capability !== undefined && stoppedCapabilities.get(capability)?.stopped === true;
}

/** Broker-only lazy construction binds pause requests to the admitted session lifetime. */
export function registerHostedAgentPauseFactory(
  target: unknown,
  factory: (signal: AbortSignal) => AgentManualPause | undefined,
): void {
  capabilityFactories.set(requirePauseCarrier(target), factory);
}

export function activateHostedAgentPauseCapability(
  target: unknown,
  signal: AbortSignal,
): AgentManualPause | undefined {
  const existing = creationCapabilities.get(requirePauseCarrier(target));
  if (existing) return existing;
  const capability = capabilityFactories.get(requirePauseCarrier(target))?.(signal);
  if (capability) creationCapabilities.set(requirePauseCarrier(target), capability);
  return capability;
}

/** Weak capability carriers are identity-only values; inspect no project-controlled fields. */
function requirePauseCarrier(value: unknown) {
  if ((typeof value === "object" && value !== null) || typeof value === "function") return value;
  throw new NativeTypeError("Invalid agent pause capability carrier");
}
