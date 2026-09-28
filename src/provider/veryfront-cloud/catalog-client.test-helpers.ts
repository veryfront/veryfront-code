/**
 * Served model catalog fixtures for tests.
 *
 * `SERVED_MODEL_ROWS` copies the `/ai/models` rows the platform serves today
 * for the models this package's shipped table lists, reduced to the fields
 * the catalog client reads. `UNSERVED_TABLE_MODEL_ROWS` describes the models
 * the shipped table still lists but the platform no longer serves, with the
 * facts the table carries, so tests written against those IDs keep working.
 * Models the gateway has retired are not listed here: they are refused.
 */
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "./catalog-client.ts";

/** Served rows for the models the shipped table lists. */
export const SERVED_MODEL_ROWS = [
  {
    "id": "claude-opus-4-8",
    "modelId": "anthropic/claude-opus-4-8",
    "provider": "anthropic",
    "surface": "anthropic",
    "operations": [
      "messages",
    ],
    "aliases": [
      "opus",
      "anthropic/claude-opus-4-8",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
      "reasoning_mode": "adaptive",
    },
  },
  {
    "id": "claude-opus-4-6",
    "modelId": "anthropic/claude-opus-4-6",
    "provider": "anthropic",
    "surface": "anthropic",
    "operations": [
      "messages",
    ],
    "aliases": [
      "anthropic/claude-opus-4-6",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
      "reasoning_mode": "budget",
      "reasoning_budget_tokens": 2048,
    },
  },
  {
    "id": "claude-sonnet-4-6",
    "modelId": "anthropic/claude-sonnet-4-6",
    "provider": "anthropic",
    "surface": "anthropic",
    "operations": [
      "messages",
    ],
    "aliases": [
      "sonnet",
      "anthropic/claude-sonnet-4-6",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
      "reasoning_mode": "budget",
      "reasoning_budget_tokens": 2048,
    },
  },
  {
    "id": "claude-haiku-4-5-20251001",
    "modelId": "anthropic/claude-haiku-4-5-20251001",
    "provider": "anthropic",
    "surface": "anthropic",
    "operations": [
      "messages",
    ],
    "aliases": [
      "haiku",
      "anthropic/claude-haiku-4-5-20251001",
      "claude-haiku-4-5",
      "anthropic/claude-haiku-4-5",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
      "reasoning_mode": "budget",
      "reasoning_budget_tokens": 1024,
    },
  },
  {
    "id": "gpt-5.5",
    "modelId": "openai/gpt-5.5",
    "provider": "openai",
    "surface": "openai",
    "operations": [
      "chat-completions",
    ],
    "aliases": [
      "openai/gpt-5.5",
      "gpt-5.5",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
      "transport": "chat-completions",
      "chat_completions_reasoning_with_function_tools": false,
    },
  },
  {
    "id": "gpt-6-sol",
    "modelId": "openai/gpt-6-sol",
    "provider": "openai",
    "surface": "openai",
    "operations": [
      "responses",
      "chat-completions",
    ],
    "aliases": [
      "openai/gpt-6-sol",
      "gpt-6-sol",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
    },
  },
  {
    "id": "gpt-6-luna",
    "modelId": "openai/gpt-6-luna",
    "provider": "openai",
    "surface": "openai",
    "operations": [
      "responses",
      "chat-completions",
    ],
    "aliases": [
      "openai/gpt-6-luna",
      "gpt-6-luna",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
    },
  },
  {
    "id": "gpt-5.4-mini",
    "modelId": "openai/gpt-5.4-mini",
    "provider": "openai",
    "surface": "openai",
    "operations": [
      "responses",
      "chat-completions",
    ],
    "aliases": [
      "openai/gpt-5.4-mini",
      "gpt-5.4-mini",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
    },
  },
  {
    "id": "gpt-5.4",
    "modelId": "openai/gpt-5.4",
    "provider": "openai",
    "surface": "openai",
    "operations": [
      "chat-completions",
    ],
    "aliases": [
      "openai/gpt-5.4",
      "gpt-5.4",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
      "transport": "chat-completions",
      "chat_completions_reasoning_with_function_tools": false,
    },
  },
  {
    "id": "gpt-5-nano",
    "modelId": "openai/gpt-5-nano",
    "provider": "openai",
    "surface": "openai",
    "operations": [
      "responses",
      "chat-completions",
    ],
    "aliases": [
      "openai/gpt-5-nano",
      "gpt-5-nano",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
    },
  },
  {
    "id": "gemini-3.5-flash",
    "modelId": "google-ai-studio/gemini-3.5-flash",
    "provider": "google",
    "surface": "google",
    "operations": [
      "generate-content",
      "stream-generate-content",
      "openai-responses",
      "openai-chat-completions",
    ],
    "aliases": [
      "google-ai-studio/gemini-3.5-flash",
      "gemini-3.5-flash",
    ],
    "capabilities": {
      "thinking": false,
      "reasoning": false,
    },
  },
  {
    "id": "gemini-2.5-pro",
    "modelId": "google-ai-studio/gemini-2.5-pro",
    "provider": "google",
    "surface": "google",
    "operations": [
      "generate-content",
      "stream-generate-content",
      "openai-responses",
      "openai-chat-completions",
    ],
    "aliases": [
      "google-ai-studio/gemini-2.5-pro",
      "gemini-2.5-pro",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
    },
  },
  {
    "id": "gemini-2.5-flash",
    "modelId": "google-ai-studio/gemini-2.5-flash",
    "provider": "google",
    "surface": "google",
    "operations": [
      "generate-content",
      "stream-generate-content",
      "openai-responses",
      "openai-chat-completions",
    ],
    "aliases": [
      "google-ai-studio/gemini-2.5-flash",
      "gemini-2.5-flash",
    ],
    "capabilities": {
      "thinking": false,
      "reasoning": false,
    },
  },
  {
    "id": "mistral-small-2503",
    "modelId": "mistral/mistral-small-2503",
    "provider": "mistral",
    "surface": "openai",
    "operations": [
      "chat-completions",
    ],
    "aliases": [
      "mistral/mistral-small-2503",
      "mistral-small-2503",
    ],
    "capabilities": {
      "thinking": false,
      "reasoning": false,
      "chat_completions_consecutive_system_messages": true,
    },
  },
  {
    "id": "kimi-k2.6",
    "modelId": "moonshotai/kimi-k2.6",
    "provider": "moonshotai",
    "surface": "openai",
    "operations": [
      "chat-completions",
    ],
    "aliases": [
      "moonshotai/kimi-k2.6",
      "kimi-k2.6",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
    },
  },
  {
    "id": "kimi-k2.5",
    "modelId": "moonshotai/kimi-k2.5",
    "provider": "moonshotai",
    "surface": "openai",
    "operations": [
      "chat-completions",
    ],
    "aliases": [
      "moonshotai/kimi-k2.5",
      "kimi-k2.5",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
    },
  },
] as const;

/** Rows for models the shipped table lists that the platform no longer serves. */
export const UNSERVED_TABLE_MODEL_ROWS = [
  {
    "id": "gpt-5.2",
    "modelId": "openai/gpt-5.2",
    "provider": "openai",
    "surface": "openai",
    "operations": [
      "responses",
      "chat-completions",
    ],
    "aliases": [
      "openai/gpt-5.2",
    ],
    "capabilities": {
      "thinking": true,
      "reasoning": true,
    },
  },
] as const;

/** Default model the platform serves. */
export const SERVED_DEFAULT_MODEL_ID = "mistral/mistral-small-2503";

/** A `/ai/models` payload with every row above. */
export function servedCatalogPayload(): Record<string, unknown> {
  return {
    models: [...SERVED_MODEL_ROWS, ...UNSERVED_TABLE_MODEL_ROWS],
    defaultModelId: SERVED_DEFAULT_MODEL_ID,
  };
}

/** Serve {@link servedCatalogPayload} to every catalog read until reset. */
export function seedServedCatalogForTests(): void {
  __setVeryfrontCloudCatalogForTests(servedCatalogPayload());
}

/**
 * Serve {@link servedCatalogPayload} until the returned handle is disposed:
 * `using _catalog = useServedCatalogForTests();`.
 */
export function useServedCatalogForTests(): Disposable {
  seedServedCatalogForTests();
  return { [Symbol.dispose]: __resetVeryfrontCloudCatalogForTests };
}
