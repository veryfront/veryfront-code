/**
 * Default Map-backed implementation of the LLMProviderRegistry contract.
 *
 * Preserves insertion order via Map (used by `list()`). Duplicate ids are
 * first-write-wins so higher-priority extensions keep their provider binding.
 *
 * @module extensions/llm/llm-provider-registry
 */

import type { LLMProvider, LLMProviderRegistry } from "./llm-provider.ts";
import {
  assertOptionalRegistrationMethod,
  assertRegistrationMethod,
  captureRegistrationId,
} from "../runtime-validation.ts";

class LLMProviderRegistryImpl implements LLMProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): void {
    const providerId = captureRegistrationId(provider, "LLMProvider");
    assertRegistrationMethod(provider, "LLMProvider", "createModel");
    assertOptionalRegistrationMethod(
      provider,
      "LLMProvider",
      "createEmbedding",
    );
    assertOptionalRegistrationMethod(
      provider,
      "LLMProvider",
      "createResponses",
    );
    if (this.providers.has(providerId)) {
      return;
    }
    this.providers.set(providerId, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  require(id: string): LLMProvider {
    const p = this.providers.get(id);
    if (p) return p;
    const known = [...this.providers.keys()].join(", ") || "(none)";
    throw new Error(
      `No LLMProvider registered for "${id}". Known providers: ${known}.`,
    );
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }
}

/** Create llmprovider registry. */
export function createLLMProviderRegistry(): LLMProviderRegistry {
  return new LLMProviderRegistryImpl();
}
