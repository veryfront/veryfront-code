/**
 * Default Map-backed implementation of the LLMProviderRegistry contract.
 *
 * Preserves insertion order via Map (used by `list()`). Re-registering the
 * same provider is idempotent, while conflicting duplicate ids fail closed.
 *
 * @module extensions/llm/llm-provider-registry
 */

import type { LLMProvider, LLMProviderRegistry } from "./llm-provider.ts";
import { RESOURCE_NOT_FOUND } from "#veryfront/errors";
import {
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_VALIDATION_ERROR,
} from "#veryfront/extensions/errors.ts";
import { identifierIssue } from "#veryfront/extensions/identifiers.ts";

const MAX_PROVIDERS = 256;
const MAX_PROVIDER_ID_LENGTH = 128;
const MAX_KNOWN_PROVIDERS_IN_ERROR = 20;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function isProviderObject(value: unknown): value is Record<string, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function assertProviderId(id: unknown): asserts id is string {
  const issue = identifierIssue(id, MAX_PROVIDER_ID_LENGTH);
  if (issue || typeof id !== "string") {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `LLM provider id ${issue ?? "must be a non-empty string"}`,
    });
  }
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message:
        "LLM provider id must start with an alphanumeric character and contain only alphanumeric, dot, underscore, colon, or hyphen characters",
    });
  }
}

function readProviderId(provider: { readonly id?: unknown }): unknown {
  try {
    return provider.id;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "LLM provider properties must be readable",
    });
  }
}

function validateProvider(provider: unknown): string {
  if (!isProviderObject(provider)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "LLM provider must be an object",
    });
  }

  let id: unknown;
  let createModel: unknown;
  let createEmbedding: unknown;
  let createResponses: unknown;
  try {
    const candidate = provider as Record<string, unknown>;
    id = readProviderId(provider);
    createModel = candidate.createModel;
    createEmbedding = candidate.createEmbedding;
    createResponses = candidate.createResponses;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "LLM provider properties must be readable",
    });
  }

  assertProviderId(id);
  if (typeof createModel !== "function") {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "LLM provider createModel must be a function",
    });
  }
  if (createEmbedding !== undefined && typeof createEmbedding !== "function") {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "LLM provider createEmbedding must be a function when provided",
    });
  }
  if (createResponses !== undefined && typeof createResponses !== "function") {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "LLM provider createResponses must be a function when provided",
    });
  }
  return id;
}

function assertStableProviderId(id: string, provider: LLMProvider): void {
  const currentId = readProviderId(provider);
  if (currentId !== id) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "LLM provider id cannot change after registration",
    });
  }
}

class LLMProviderRegistryImpl implements LLMProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();
  private readonly registeredIds = new WeakMap<LLMProvider, string>();

  register(provider: LLMProvider): void {
    const id = validateProvider(provider);
    if (readProviderId(provider) !== id) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "LLM provider id must remain stable during registration",
      });
    }
    const registeredId = this.registeredIds.get(provider);
    if (registeredId !== undefined && registeredId !== id) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "LLM provider id cannot change after registration",
      });
    }
    const existing = this.providers.get(id);
    if (existing === provider) return;
    if (existing) {
      throw EXTENSION_CONFLICT_ERROR.create({
        message: `LLM provider "${id}" is already registered`,
      });
    }
    if (this.providers.size >= MAX_PROVIDERS) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `You can register at most ${MAX_PROVIDERS} LLM providers`,
      });
    }
    this.providers.set(id, provider);
    this.registeredIds.set(provider, id);
  }

  unregister(id: string): void {
    assertProviderId(id);
    const provider = this.providers.get(id);
    this.providers.delete(id);
    if (provider) this.registeredIds.delete(provider);
  }

  get(id: string): LLMProvider | undefined {
    assertProviderId(id);
    const provider = this.providers.get(id);
    if (provider) assertStableProviderId(id, provider);
    return provider;
  }

  require(id: string): LLMProvider {
    const p = this.get(id);
    if (p) return p;
    const knownIds = [...this.providers.keys()];
    const known = knownIds.slice(0, MAX_KNOWN_PROVIDERS_IN_ERROR).join(", ") || "(none)";
    const suffix = knownIds.length > MAX_KNOWN_PROVIDERS_IN_ERROR ? ", ..." : "";
    throw RESOURCE_NOT_FOUND.create({
      message: `No LLM provider is registered for "${id}". Known providers: ${known}${suffix}.`,
    });
  }

  has(id: string): boolean {
    assertProviderId(id);
    const provider = this.providers.get(id);
    if (provider) assertStableProviderId(id, provider);
    return provider !== undefined;
  }

  list(): LLMProvider[] {
    return [...this.providers.entries()].map(([id, provider]) => {
      assertStableProviderId(id, provider);
      return provider;
    });
  }
}

/** Create an LLM provider registry. */
export function createLLMProviderRegistry(): LLMProviderRegistry {
  return new LLMProviderRegistryImpl();
}
