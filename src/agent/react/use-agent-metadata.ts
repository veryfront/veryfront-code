import { useEffect, useState } from "react";
import { ensureError, INPUT_VALIDATION_FAILED, NETWORK_ERROR } from "#veryfront/errors";

/** Source-defined prompt suggestion shown by chat surfaces. */
export type AgentMetadataPromptSuggestion =
  | {
    type: "prompt";
    title?: string;
    prompt: string;
  }
  | {
    id: string;
    type: "prompt";
  };

/** Source-defined task suggestion shown by chat surfaces. */
export type AgentMetadataTaskSuggestion = {
  type: "task";
  id: string;
};

/** Source-defined agent suggestion. */
export type AgentMetadataSuggestion = AgentMetadataPromptSuggestion | AgentMetadataTaskSuggestion;

/** Source-defined suggestion group for an agent. */
export interface AgentMetadataSuggestions {
  welcomeMessage?: string;
  suggestions: AgentMetadataSuggestion[];
}

/** Browser-safe source-defined agent metadata. */
export interface AgentMetadata {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  suggestions?: AgentMetadataSuggestions;
}

/** Result returned from useAgentMetadata. */
export interface UseAgentMetadataResult {
  agent: AgentMetadata | null;
  isLoading: boolean;
  error: Error | null;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getRequiredString(record: RecordValue, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid agent metadata: ${key} is required` });
  }
  return value;
}

function getNullableString(record: RecordValue, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Invalid agent metadata: ${key} must be a string`,
    });
  }
  return value;
}

function normalizeSuggestion(value: unknown): AgentMetadataSuggestion {
  if (!isRecord(value)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Invalid agent metadata: suggestion must be an object",
    });
  }

  if (value.type === "task") {
    return {
      type: "task",
      id: getRequiredString(value, "id"),
    };
  }

  if (value.type !== "prompt") {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Invalid agent metadata: unsupported suggestion type",
    });
  }

  if (typeof value.id === "string") {
    return {
      id: getRequiredString(value, "id"),
      type: "prompt",
    };
  }

  return {
    type: "prompt",
    title: getRequiredString(value, "title"),
    prompt: getRequiredString(value, "prompt"),
  };
}

function normalizeSuggestions(value: unknown): AgentMetadataSuggestions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Invalid agent metadata: suggestions must be an object",
    });
  }

  const rawSuggestions = value.suggestions;
  if (!Array.isArray(rawSuggestions)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Invalid agent metadata: suggestions must be an array",
    });
  }

  const welcomeMessage = value.welcomeMessage;
  return {
    ...(typeof welcomeMessage === "string" && welcomeMessage.trim().length > 0
      ? { welcomeMessage }
      : {}),
    suggestions: rawSuggestions.map(normalizeSuggestion),
  };
}

/**
 * Normalize a single browser-safe agent record (the `agent` object inside the
 * `/api/agents/:id` response, or one entry of the `/api/agents` list).
 */
export function normalizeAgentMetadata(value: unknown): AgentMetadata {
  if (!isRecord(value)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Invalid agent metadata: agent must be an object",
    });
  }

  return {
    id: getRequiredString(value, "id"),
    name: getRequiredString(value, "name"),
    description: getNullableString(value, "description"),
    avatarUrl: getNullableString(value, "avatar_url"),
    suggestions: normalizeSuggestions(value.suggestions),
  };
}

/** Normalize the wire response from /api/agents/:id. */
export function normalizeAgentMetadataResponse(value: unknown): AgentMetadata {
  if (!isRecord(value)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid agent metadata response" });
  }
  return normalizeAgentMetadata(value.agent);
}

/** Return prompt text suggestions that the current Chat component can render. */
export function getAgentPromptSuggestions(agent: AgentMetadata | null): string[] {
  return agent?.suggestions?.suggestions.flatMap((suggestion) => {
    if (suggestion.type !== "prompt" || !("prompt" in suggestion)) return [];
    return [suggestion.prompt];
  }) ?? [];
}

/**
 * A prompt suggestion normalized for rendering: the short `label` shown on the
 * chip and the full `prompt` sent when it is clicked.
 */
export interface PromptSuggestion {
  /** Short chip label — the agent's `title`, falling back to the prompt. */
  label: string;
  /** Full text sent to the agent when the chip is clicked. */
  prompt: string;
}

/**
 * Normalize an agent's prompt suggestions to `{ label, prompt }[]`, ready to
 * render — the chip shows the short `title` while the click sends the full
 * `prompt`. Saves consumers from flat-mapping `agent.suggestions.suggestions`
 * and reconciling the `title`/`prompt` fields themselves.
 */
export function getAgentPromptSuggestionItems(
  agent: AgentMetadata | null,
): PromptSuggestion[] {
  const list = agent?.suggestions?.suggestions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((suggestion) => {
    if (suggestion.type !== "prompt" || !("prompt" in suggestion) || !suggestion.prompt) {
      return [];
    }
    const title = (suggestion as { title?: unknown }).title;
    const label = typeof title === "string" && title.length > 0 ? title : suggestion.prompt;
    return [{ label, prompt: suggestion.prompt }];
  });
}

/** React hook for browser-safe source-defined agent metadata. */
export function useAgentMetadata(agentId: string | null | undefined): UseAgentMetadataResult {
  const [agent, setAgent] = useState<AgentMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(agentId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!agentId) {
      setAgent(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const resolvedAgentId = agentId;
    const abortController = new AbortController();
    setIsLoading(true);
    setError(null);

    async function loadAgentMetadata(): Promise<void> {
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(resolvedAgentId)}`, {
          headers: { accept: "application/json" },
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw NETWORK_ERROR.create({
            detail: `Agent metadata request failed: ${response.status}`,
          });
        }

        const nextAgent = normalizeAgentMetadataResponse(await response.json());
        setAgent(nextAgent);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setAgent(null);
        setError(ensureError(caught));
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadAgentMetadata();

    return () => {
      abortController.abort();
    };
  }, [agentId]);

  return { agent, isLoading, error };
}
