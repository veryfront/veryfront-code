/**
 * Anthropic provider — implements the {@link AIProvider} contract.
 *
 * Initial implementation delegates to the legacy `createAnthropicModelRuntime`
 * factory still living in core's `runtime-loader.ts`. Task 7 moves that
 * factory into this file along with all Anthropic-specific helpers.
 */

import type {
  AIProvider,
  AIProviderConfig,
} from "veryfront/extensions/interfaces";
import type { ModelRuntime } from "veryfront/provider/types";
import { createAnthropicModelRuntime } from "../../../src/provider/runtime-loader.ts";

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    const anthropicConfig = {
      apiKey: config.credential,
      authToken: typeof config.authToken === "string" ? config.authToken : undefined,
      baseURL: config.baseURL,
      name: config.name ?? "anthropic",
      fetch: config.fetch,
    };
    return createAnthropicModelRuntime(anthropicConfig, modelId);
  }
}
