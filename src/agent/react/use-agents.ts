import { useCallback, useEffect, useState } from "react";
import { ensureError, INPUT_VALIDATION_FAILED, NETWORK_ERROR } from "#veryfront/errors";
import { type AgentMetadata, normalizeAgentMetadata } from "./use-agent-metadata.ts";

/** Options accepted by {@link useAgents}. */
export interface UseAgentsOptions {
  /**
   * When `false`, the request is skipped and the hook stays idle with an empty
   * list. Flip it to `true` to fetch (or refetch). Defaults to `true`.
   */
  enabled?: boolean;
}

/** Result returned from {@link useAgents}. */
export interface UseAgentsResult {
  /** Browser-safe metadata for every agent the project exposes, sorted by name. */
  agents: AgentMetadata[];
  /** `true` while the list request is in flight. */
  isLoading: boolean;
  /** The last request error, or `null`. */
  error: Error | null;
  /** Re-run the request, bypassing nothing — always hits the network. */
  refetch: () => void;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normalize the wire response from `GET /api/agents`. */
export function normalizeAgentsListResponse(value: unknown): AgentMetadata[] {
  if (!isRecord(value) || !Array.isArray(value.agents)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid agents list response: agents must be an array" });
  }
  return value.agents.map(normalizeAgentMetadata);
}

/**
 * React hook that lists the browser-safe agents a project exposes, via
 * `GET /api/agents`. Companion to {@link useAgentMetadata} (single agent) — use
 * it to drive an agent switcher, e.g. only rendering a picker when
 * `agents.length > 1`.
 *
 * The in-flight request is aborted on unmount, on option change, and before a
 * `refetch`, so state never lands from a stale response.
 */
export function useAgents(options: UseAgentsOptions = {}): UseAgentsResult {
  const { enabled = true } = options;
  const [agents, setAgents] = useState<AgentMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  // Bumping this re-runs the effect below to force a fresh request.
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setAgents([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const abortController = new AbortController();
    setIsLoading(true);
    setError(null);

    async function loadAgents(): Promise<void> {
      try {
        const response = await fetch("/api/agents", {
          headers: { accept: "application/json" },
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw NETWORK_ERROR.create({ detail: `Agents list request failed: ${response.status}` });
        }

        setAgents(normalizeAgentsListResponse(await response.json()));
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setAgents([]);
        setError(ensureError(caught));
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadAgents();

    return () => {
      abortController.abort();
    };
  }, [enabled, reloadToken]);

  return { agents, isLoading, error, refetch };
}
