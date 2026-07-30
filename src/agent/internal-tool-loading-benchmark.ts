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

export { runAgentToolLoadingBenchmark } from "./factory.ts";
export type { AgentToolLoadingBenchmarkObservation } from "./types.ts";
