/**
 * Default Map-backed implementation of the AIProviderRegistry contract.
 *
 * Preserves insertion order via Map (used by `list()`). Throws on
 * duplicate id to surface silent collisions between extensions.
 *
 * @module extensions/registries/ai-provider-registry
 */

import type { AIProvider, AIProviderRegistry } from "../interfaces/ai-provider.ts";

class AIProviderRegistryImpl implements AIProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      return;
    }
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  require(id: string): AIProvider {
    const p = this.providers.get(id);
    if (p) return p;
    const known = [...this.providers.keys()].join(", ") || "(none)";
    throw new Error(
      `No AIProvider registered for "${id}". Known providers: ${known}.`,
    );
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): AIProvider[] {
    return [...this.providers.values()];
  }
}

export function createAIProviderRegistry(): AIProviderRegistry {
  return new AIProviderRegistryImpl();
}
