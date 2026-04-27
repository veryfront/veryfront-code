/**
 * Google provider — implements the {@link AIProvider} contract.
 *
 * Initial implementation delegates to the legacy `createGoogleModelRuntime`
 * and `createGoogleEmbeddingRuntime` factories still living in core's
 * `runtime-loader.ts`. Task 7 moves those factories into this file along
 * with all Google-specific helpers.
 */

import type {
  AIProvider,
  AIProviderConfig,
} from "veryfront/extensions/interfaces";
import type {
  EmbeddingRuntime,
  ModelRuntime,
} from "veryfront/provider/types";
import {
  createGoogleEmbeddingRuntime,
  createGoogleModelRuntime,
} from "../../../src/provider/runtime-loader.ts";

export class GoogleProvider implements AIProvider {
  readonly id = "google";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createGoogleModelRuntime({
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: config.name ?? "google",
      fetch: config.fetch,
    }, modelId);
  }

  createEmbedding(modelId: string, config: AIProviderConfig): EmbeddingRuntime {
    return createGoogleEmbeddingRuntime({
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: config.name ?? "google",
      fetch: config.fetch,
    }, modelId);
  }
}
