/**
 * Default Map-backed implementation of the AIProviderRegistry contract.
 *
 * Pre-registers built-in providers (Anthropic, Google) so every consumer
 * works out of the box.  Extensions can override a built-in by calling
 * `register()` with the same id — built-ins are silently replaced while
 * collisions between two extensions still throw.
 *
 * @module extensions/registries/ai-provider-registry
 */

import type { AIProvider, AIProviderRegistry } from "../interfaces/ai-provider.ts";
import { createAnthropicModelRuntime, createGoogleModelRuntime } from "#veryfront/provider/runtime-loader.ts";
import type { AIProviderConfig } from "../interfaces/ai-provider.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";

class BuiltinAnthropicProvider implements AIProvider {
  readonly id = "anthropic";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createAnthropicModelRuntime({
      apiKey: config.credential,
      authToken: typeof config.authToken === "string" ? config.authToken : undefined,
      baseURL: config.baseURL,
      name: config.name ?? "anthropic",
      fetch: config.fetch,
    }, modelId);
  }
}

class BuiltinGoogleProvider implements AIProvider {
  readonly id = "google";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createGoogleModelRuntime({
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: config.name ?? "google",
      fetch: config.fetch,
    }, modelId);
  }
}

class AIProviderRegistryImpl implements AIProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();
  private readonly builtins = new Set<string>();

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id) && !this.builtins.has(provider.id)) {
      throw new Error(
        `AIProvider "${provider.id}" is already registered. ` +
          `Call unregister("${provider.id}") first if you intend to replace it.`,
      );
    }
    this.builtins.delete(provider.id);
    this.providers.set(provider.id, provider);
  }

  registerBuiltin(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
    this.builtins.add(provider.id);
  }

  unregister(id: string): void {
    this.providers.delete(id);
    this.builtins.delete(id);
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
  const registry = new AIProviderRegistryImpl();
  registry.registerBuiltin(new BuiltinAnthropicProvider());
  registry.registerBuiltin(new BuiltinGoogleProvider());
  return registry;
}
