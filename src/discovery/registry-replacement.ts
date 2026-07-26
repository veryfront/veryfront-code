import { agentRegistry } from "#veryfront/agent/composition/composition.ts";
import { promptRegistry } from "#veryfront/prompt/registry.ts";
import { resourceRegistry } from "#veryfront/resource/registry.ts";
import { runWithRegistryTransaction } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import { discoverAll } from "./discovery-engine.ts";
import { clearTranspileCache } from "./transpiler.ts";
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
 * Discovery can continue collecting independent file failures, but a
 * generation containing any failure is never published. Concurrent readers
 * therefore see either the complete previous generation or the complete new
 * one, never a partial mix.
 */
export async function replaceDiscoveredProjectPrimitives(
  config: DiscoveryConfig,
  options: ReplaceDiscoveredProjectPrimitivesOptions = {},
): Promise<DiscoveryResult> {
  return await runWithRegistryTransaction(async () => {
    clearTranspileCache();
    agentRegistry.clear();
    toolRegistry.clear();
    skillRegistry.clear();
    promptRegistry.clear();
    resourceRegistry.clear();
    workflowRegistry.clear();

    const result = await discoverAll(config);
    if (result.errors.length > 0 && options.errorPolicy !== "publish-valid") {
      throw new DiscoveryGenerationError(result);
    }
    return result;
  });
}
