import { AsyncLocalStorage } from "node:async_hooks";
import {
  type ConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
  type HostedConversationRunChunkMirrorOptions,
} from "../conversation/run-chunk-mirror.ts";

const DEFAULT_CHILD_RUN_EVENT_WRITER_TOKEN_TIMEOUT_MS = 10_000;
const CHILD_RUN_EVENT_WRITER_TOKEN_SETUP_ERROR =
  "Unable to initialize durable child event persistence";

type Fetch = typeof globalThis.fetch;

/** Internal failure raised when the control plane cannot issue an exact-child writer token. */
export class HostedChildRunEventWriterTokenExchangeError extends Error {
  readonly classification: "aborted" | "failed";

  constructor(classification: "aborted" | "failed" = "failed") {
    super(CHILD_RUN_EVENT_WRITER_TOKEN_SETUP_ERROR);
    this.name = "HostedChildRunEventWriterTokenExchangeError";
    this.classification = classification;
  }
}

/** Non-serializable authority that can delegate only to a direct child run. */
export interface HostedRunEventWriterCapability {
  mintChildRunEventAppendToken(
    childRunId: string,
    abortSignal?: AbortSignal,
  ): Promise<HostedRunEventWriterCapability>;
}

type CapabilityState = {
  apiUrl: string;
  runId: string;
  runEventAppendToken: string;
  timeoutMs: number;
  fetch: Fetch;
};

const capabilityState = new WeakMap<HostedRunEventWriterCapability, CapabilityState>();
const capabilityStorage = new AsyncLocalStorage<HostedRunEventWriterCapability>();

function isNoStoreResponse(response: Response): boolean {
  return response.headers.get("Cache-Control")?.split(",").some((directive) =>
    directive.trim().toLowerCase() === "no-store"
  ) ?? false;
}

function parseRunEventToken(value: unknown): string {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, "run_event_token")
  ) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }

  const token = (value as { run_event_token?: unknown }).run_event_token;
  if (typeof token !== "string" || token.length === 0 || token.trim() !== token) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }

  return token;
}

async function exchangeChildRunEventWriterToken(
  state: CapabilityState,
  childRunId: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(state.timeoutMs);
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal;
  const url = new URL(
    `/runs/${encodeURIComponent(state.runId)}/children/${
      encodeURIComponent(childRunId)
    }/event-writer-token`,
    state.apiUrl,
  );

  try {
    const response = await state.fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${state.runEventAppendToken}`,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
      signal,
    });

    if (!response.ok || !isNoStoreResponse(response)) {
      throw new HostedChildRunEventWriterTokenExchangeError();
    }

    return parseRunEventToken(await response.json());
  } catch (error) {
    if (error instanceof HostedChildRunEventWriterTokenExchangeError) throw error;
    throw new HostedChildRunEventWriterTokenExchangeError(
      abortSignal?.aborted ? "aborted" : "failed",
    );
  }
}

/** Create an exact-run capability while keeping its credential in module-private state. */
export function createHostedRunEventWriterCapability(input: {
  apiUrl: string;
  runId: string;
  runEventAppendToken: string;
  timeoutMs?: number;
  fetch?: Fetch;
}): HostedRunEventWriterCapability {
  const state: CapabilityState = {
    apiUrl: input.apiUrl,
    runId: input.runId,
    runEventAppendToken: input.runEventAppendToken,
    timeoutMs: input.timeoutMs ?? DEFAULT_CHILD_RUN_EVENT_WRITER_TOKEN_TIMEOUT_MS,
    fetch: input.fetch ?? globalThis.fetch,
  };
  const capability = Object.create(null) as HostedRunEventWriterCapability;
  Object.defineProperty(capability, "mintChildRunEventAppendToken", {
    enumerable: false,
    value: async (childRunId: string, abortSignal?: AbortSignal) => {
      const childToken = await exchangeChildRunEventWriterToken(state, childRunId, abortSignal);
      return createHostedRunEventWriterCapability({
        apiUrl: state.apiUrl,
        runId: childRunId,
        runEventAppendToken: childToken,
        timeoutMs: state.timeoutMs,
        fetch: state.fetch,
      });
    },
  });
  capabilityState.set(capability, state);
  return Object.freeze(capability);
}

/** Build a durable mirror from private capability state without exposing its credential. */
export function createHostedConversationRunChunkMirrorFromCapability(
  capability: HostedRunEventWriterCapability | undefined,
  input: Omit<HostedConversationRunChunkMirrorOptions, "authToken">,
): ConversationRunChunkMirror | undefined {
  if (!capability) return undefined;
  const state = capabilityState.get(capability);
  if (!state) return undefined;
  return createHostedConversationRunChunkMirror({ ...input, authToken: state.runEventAppendToken });
}

/** Return the capability installed only while internal tool closures are assembled. */
export function getActiveHostedRunEventWriterCapability():
  | HostedRunEventWriterCapability
  | undefined {
  return capabilityStorage.getStore();
}

/** Assemble internal child tools while privately binding their exact-run authority. */
export function runWithHostedRunEventWriterCapability<T>(
  capability: HostedRunEventWriterCapability | undefined,
  operation: () => T,
): T {
  return capability ? capabilityStorage.run(capability, operation) : operation();
}
