import type {
  IntegrationClient,
  IntegrationConnectionStatus,
  IntegrationConnectionWaitOptions,
  IntegrationConnectionWaitOutcome,
} from "./client-types.ts";

/** Upper bound for one wait; a longer consent needs a new handoff anyway. */
export const MAX_INTEGRATION_CONNECTION_WAIT_MS = 15 * 60 * 1000;
const INITIAL_POLL_DELAY_MS = 250;
const MAX_POLL_DELAY_MS = 2000;

/** UUIDs compare case-insensitively; the response validators accept either casing. */
function identity(status: IntegrationConnectionStatus): { id?: string; generation?: string } {
  return {
    id: (status.connection_id ?? status.connectionId)?.toLowerCase(),
    generation: (status.connection_generation_id ?? status.connectionGenerationId)?.toLowerCase(),
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** @internal Implementation of `IntegrationClient.waitForConnection`. */
export async function waitForIntegrationConnection(
  client: Pick<IntegrationClient, "status" | "listConnections">,
  integration: string,
  options: IntegrationConnectionWaitOptions,
): Promise<IntegrationConnectionWaitOutcome> {
  const { scope, before, timeoutMs, abortSignal } = options;
  if (scope !== "user" && scope !== "project") {
    throw new TypeError("Connection wait requires an explicit user or project scope");
  }
  if (
    !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_INTEGRATION_CONNECTION_WAIT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be an integer between 1 and ${MAX_INTEGRATION_CONNECTION_WAIT_MS}`,
    );
  }
  abortSignal?.throwIfAborted();
  // A disconnected baseline still names its row; the same id and generation is not new consent.
  const previous = before ? identity(before) : undefined;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = abortSignal ? AbortSignal.any([abortSignal, deadline.signal]) : deadline.signal;
  const timedOut = { status: "timed_out", integration, scope } as const;
  let pollDelay = INITIAL_POLL_DELAY_MS;
  try {
    while (true) {
      try {
        const status = await client.status(integration, scope, { abortSignal: signal });
        const current = identity(status);
        const replaced = !previous?.id || !previous.generation ||
          current.id !== previous.id || current.generation !== previous.generation;
        if (status.connected && current.id && current.generation && replaced) {
          for await (
            const connection of client.listConnections(integration, { abortSignal: signal })
          ) {
            if (
              connection.id.toLowerCase() === current.id &&
              connection.connection_generation_id.toLowerCase() === current.generation &&
              connection.scope === scope && connection.status === "connected"
            ) {
              return {
                status: "connection_observed",
                integration,
                scope,
                connection,
                connection_status: status,
              };
            }
          }
        }
        await delay(pollDelay, signal);
      } catch (error) {
        if (abortSignal?.aborted) throw abortSignal.reason;
        if (deadline.signal.aborted) return timedOut;
        throw error;
      }
      pollDelay = Math.min(pollDelay * 2, MAX_POLL_DELAY_MS);
    }
  } finally {
    clearTimeout(timer);
  }
}
