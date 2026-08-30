import { createOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED } from "#veryfront/errors";
import {
  createProviderReplayCheckpointEvent,
  type ProviderReplayCheckpoint,
} from "#veryfront/agent/runtime/provider-replay.ts";

const PROVIDER_REPLAY_APPEND_TIMEOUT_MS = 15_000;

/** Create an exact-run checkpoint writer backed by the API's durable append route. */
export function createRunScopedProviderReplayCheckpointPersister(input: {
  apiUrl: string;
  runId: string;
  runEventToken: string;
  fetch?: typeof globalThis.fetch;
}): (checkpoint: ProviderReplayCheckpoint) => Promise<void> {
  const fetchImpl = input.fetch ?? createOriginBoundOutboundFetch(input.apiUrl);
  const url = new URL(`/runs/${encodeURIComponent(input.runId)}/events`, input.apiUrl);

  return async (checkpoint) => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.runEventToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          events: [createProviderReplayCheckpointEvent(checkpoint)],
        }),
        signal: AbortSignal.timeout(PROVIDER_REPLAY_APPEND_TIMEOUT_MS),
      });
    } catch {
      throw DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({
        detail: "Provider replay checkpoint append request failed",
      });
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({
        detail: `Provider replay checkpoint append returned HTTP ${response.status}`,
      });
    }
    await response.body?.cancel().catch(() => undefined);
  };
}
