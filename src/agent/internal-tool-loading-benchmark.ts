/**
 * Internal controls for reproducible eager/deferred agent eval benchmarks.
 *
 * This module is intentionally available only through the `_internal` package
 * subpath. It is not part of the public `veryfront/agent` contract.
 *
 * @example Internal eval harness
 * ```ts
 * import { runAgentToolLoadingBenchmark } from "veryfront/_internal/agent-tool-loading-benchmark";
 *
 * await runAgentToolLoadingBenchmark(assistant, { input: "hi" }, {
 *   toolLoading: "deferred",
 * });
 * ```
 *
 * @module agent-internal-tool-loading-benchmark
 */

import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";

/** Request identity used only by the internal tool-loading benchmark harness. */
export type AgentToolLoadingBenchmarkRequestContext = {
  projectSlug: string;
  projectId?: string;
  authToken: string;
};

/**
 * Run an internal tool-loading benchmark inside an isolated project request context.
 *
 * @internal
 */
export function runWithAgentToolLoadingBenchmarkRequestContext<TResult>(
  context: AgentToolLoadingBenchmarkRequestContext,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  return runWithRequestContext(
    {
      projectSlug: context.projectSlug,
      projectId: context.projectId,
      token: context.authToken,
      productionMode: false,
    },
    operation,
  );
}

export { runAgentToolLoadingBenchmark } from "./factory.ts";
export type { AgentToolLoadingBenchmarkObservation } from "./types.ts";
