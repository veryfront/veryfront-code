import { runWithRegistryTransaction } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { discoverAll } from "./discovery-engine.ts";
import type { DiscoveryConfig, DiscoveryResult } from "./types.ts";

export type DiscoveryGenerationErrorPolicy = "reject" | "publish-valid";

export interface ReplaceDiscoveredProjectPrimitivesOptions {
  /**
   * Controls whether a generation containing discovery errors is published.
   *
   * Strict lifecycle boundaries should retain the default `reject` policy so
   * the previous complete generation remains live. One-shot runtimes that
   * expose discovery errors to their caller may explicitly publish the valid
   * subset as one atomic generation.
   */
  errorPolicy?: DiscoveryGenerationErrorPolicy;
}

/**
 * A candidate discovery generation contained errors and was not published.
 *
 * The full result is retained for safe diagnostics, while the message avoids
 * embedding local paths or project-authored error text.
 */
export class DiscoveryGenerationError extends Error {
  constructor(readonly result: DiscoveryResult) {
    super(
      `Discovery generation rejected with ${result.errors.length} ` +
        `error${result.errors.length === 1 ? "" : "s"}`,
    );
    this.name = "DiscoveryGenerationError";
  }
}

/**
 * Replace every project-scoped primitive registry as one atomic generation.
 *
 * Discovery can continue collecting independent file failures. By default a
 * generation containing any failure is rejected; `publish-valid` explicitly
 * publishes the successfully discovered entries together as one generation.
 * Concurrent readers therefore see either the complete previous generation
 * or one complete replacement generation, never an in-progress mix.
 */
export async function replaceDiscoveredProjectPrimitives(
  config: DiscoveryConfig,
  options: ReplaceDiscoveredProjectPrimitivesOptions = {},
): Promise<DiscoveryResult> {
  return await runWithRegistryTransaction(async () => {
    // The transpiler cache is content- and dependency-aware and includes the
    // registry scope, adapter identity, and source-generation namespace. Keep
    // valid modules across transactional registry replacement so repeated
    // preview discovery does not accumulate duplicate ESM module instances.
    const result = await discoverAll(config);
    if (result.errors.length > 0 && options.errorPolicy !== "publish-valid") {
      throw new DiscoveryGenerationError(result);
    }
    return result;
  });
}
