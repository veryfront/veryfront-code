import { defineSchema } from "#veryfront/schemas/index.ts";
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
  v.object({ stop: v.boolean(), checkpoint: v.union([v.null(), getAgentPauseCheckpointSchema()]) })
    .strict()
);
/**
 * A host lifecycle object (agent creation options, root context, broker
 * session) whose identity alone carries pause state; no fields are read.
 */
export type HostedAgentPauseCarrier = object;

const credentials = createPrivateWeakStore<object, { token: string; runId: string }>();
const creationCapabilities = createPrivateWeakStore<object, AgentManualPause>();
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

function bodyOf(response: Response): ReadableStream<Uint8Array> | null {
  return apply(responseBody, response, []);
}

async function cancelResponse(response: Response): Promise<void> {
  const body = bodyOf(response);
  if (body) await cancelPrivateStream(body);
}

async function readReply(response: Response, signal: AbortSignal): Promise<unknown> {
  const body = bodyOf(response);
  const safeBody = body === null ? null : {
    __proto__: null,
    getReader: () => getPrivateStreamReader(body),
  };
  const safeResponse = { __proto__: null, body: safeBody };
  const reply = await readResponseTextPrefix(safeResponse, 2 * 1024 * 1024, signal, {
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
  signal: AbortSignal;
  fetch?: typeof fetch;
}): AgentManualPause {
  const endpoint = requireHostPrivateApiHttps(input.apiUrl);
  let end = endpoint.length;
  while (end > 0 && privateTextCharCodeAt(endpoint, end - 1) === 47) end--;
  const apiUrl = privateTextSlice(endpoint, 0, end);
  const transport = input.fetch ?? createVeryfrontApiOriginBoundOutboundFetch(apiUrl);
  const token = input.token;
  const signal = input.signal;
  const path = `${apiUrl}/runs/${encode(input.runId)}`;
  const send = async (suffix: string, body: string | undefined) => {
    try {
      return await transport(`${path}/${suffix}`, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        signal: requestSignal(signal),
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
        return { value: parse(await readReply(response, signal)) };
      } catch {
        // Malformed or lost replies never become permission to continue.
        return undefined;
      }
    }
    await cancelResponse(response);
    if (status < 500) throw agentManualPauseBoundary();
    return undefined;
  };
  const request = async <T>(
    suffix: string,
    body: string | undefined,
    parse: (value: unknown) => T,
    attempt = 0,
  ): Promise<T> => {
    if (signal.aborted) throw agentManualPauseBoundary();
    const settled = await settle(await send(suffix, body), parse);
    if (settled) return settled.value;
    if (signal.aborted) throw agentManualPauseBoundary();
    await new NativePromise<void>((resolve) =>
      schedule(resolve, minimum(1000, 100 * 2 ** minimum(attempt, 4)))
    );
    return request(suffix, body, parse, attempt + 1);
  };
  const state = { stopped: false };
  const capability = freeze({
    async load() {
      state.stopped = true;
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
      return reply.checkpoint == null ? null : parseAgentPauseCheckpoint(reply.checkpoint);
    },
    async acknowledge(checkpoint: AgentPauseCheckpoint) {
      const body = privateJsonStringify({ checkpoint: parseAgentPauseCheckpoint(checkpoint) })!;
      state.stopped = true;
      const stop = (await request("pause-ack", body, (value) => getAckSchema().parse(value))).stop;
      state.stopped = stop;
      return stop;
    },
  });
  stoppedCapabilities.set(capability, state);
  creationCapabilities.set(capability, capability);
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
  signal: AbortSignal,
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

export function registerHostedAgentPauseCreationOptions(
  options: HostedAgentPauseCarrier,
  request: ParsedHostedChatRequest,
  signal: AbortSignal,
  rootContext?: HostedAgentPauseCarrier,
): void {
  const capability = createHostedAgentManualPause(request, signal);
  if (capability) {
    creationCapabilities.set(options, capability);
    if (rootContext) creationCapabilities.set(rootContext, capability);
  }
}

export function getHostedAgentPauseCreationOptions(
  options: HostedAgentPauseCarrier,
): AgentManualPause | undefined {
  return creationCapabilities.get(options);
}

/** Carry exact-dispatch stop state through host lifecycle objects without public fields. */
export function inheritHostedAgentPauseCapability(
  target: HostedAgentPauseCarrier,
  source: HostedAgentPauseCarrier,
  lifetimeSignal?: AbortSignal,
): void {
  const factory = capabilityFactories.get(source);
  if (factory) {
    capabilityFactories.set(
      target,
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
  const capability = creationCapabilities.get(source);
  if (capability) creationCapabilities.set(target, capability);
}

export function hasHostedAgentPauseStopped(lifecycle: HostedAgentPauseCarrier): boolean {
  const capability = creationCapabilities.get(lifecycle);
  return capability !== undefined && stoppedCapabilities.get(capability)?.stopped === true;
}

/** Broker-only lazy construction binds pause requests to the admitted session lifetime. */
export function registerHostedAgentPauseFactory(
  target: HostedAgentPauseCarrier,
  factory: (signal: AbortSignal) => AgentManualPause | undefined,
): void {
  capabilityFactories.set(target, factory);
}

export function activateHostedAgentPauseCapability(
  target: HostedAgentPauseCarrier,
  signal: AbortSignal,
): AgentManualPause | undefined {
  const existing = creationCapabilities.get(target);
  if (existing) return existing;
  const capability = capabilityFactories.get(target)?.(signal);
  if (capability) creationCapabilities.set(target, capability);
  return capability;
}
