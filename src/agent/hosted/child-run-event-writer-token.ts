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
  readonly classification: "aborted" | "timeout" | "failed";

  constructor(classification: "aborted" | "timeout" | "failed" = "failed") {
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
const requestRunEventWriterTokens = new WeakMap<object, string>();
const capabilityStorage = new AsyncLocalStorage<HostedRunEventWriterCapability | undefined>();

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
  const controller = new AbortController();
  let cancellation: "aborted" | "timeout" | undefined;
  const cancel = (classification: "aborted" | "timeout") => {
    if (controller.signal.aborted) return;
    cancellation = classification;
    controller.abort();
  };
  const onAbort = () => cancel("aborted");
  if (abortSignal?.aborted) {
    cancel("aborted");
  } else {
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  }
  const timeoutId = setTimeout(() => cancel("timeout"), state.timeoutMs);
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
      signal: controller.signal,
    });
    if (cancellation) {
      throw new HostedChildRunEventWriterTokenExchangeError(cancellation);
    }

    if (!response.ok || !isNoStoreResponse(response)) {
      throw new HostedChildRunEventWriterTokenExchangeError();
    }

    const token = parseRunEventToken(await response.json());
    if (cancellation) {
      throw new HostedChildRunEventWriterTokenExchangeError(cancellation);
    }
    return token;
  } catch (error) {
    if (error instanceof HostedChildRunEventWriterTokenExchangeError) throw error;
    throw new HostedChildRunEventWriterTokenExchangeError(cancellation ?? "failed");
  } finally {
    clearTimeout(timeoutId);
    abortSignal?.removeEventListener("abort", onAbort);
  }
}

/** Retain a verified ingress credential without adding it to the parsed request contract. */
export function registerHostedRunEventWriterToken(request: object, token: string): void {
  requestRunEventWriterTokens.set(request, token);
}

/** Create the opaque exact-run capability associated with a verified parsed request. */
export function createHostedRunEventWriterCapabilityForRequest(
  request: object,
  input: Omit<Parameters<typeof createHostedRunEventWriterCapability>[0], "runEventAppendToken">,
): HostedRunEventWriterCapability | undefined {
  const token = requestRunEventWriterTokens.get(request);
  return token
    ? createHostedRunEventWriterCapability({ ...input, runEventAppendToken: token })
    : undefined;
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
  return capabilityStorage.run(capability, operation);
}
