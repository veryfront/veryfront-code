/**
 * Typed SDK for the Runs target contract, with the pinned contract's operation, input and
 * output types. The legacy client stays at `veryfront/runs` until the cutover removes it.
 *
 * @module
 *
 * @example
 * ```ts
 * import { createRunsSdk, type RunsOutput } from "veryfront/runs/target";
 *
 * const runs = createRunsSdk({
 *   baseUrl: "https://api.veryfront.com",
 *   transport: fetch,
 *   credential: { bearer: process.env.VERYFRONT_API_TOKEN! },
 * });
 *
 * const run: RunsOutput<"getRun"> = await runs.getRun({ path: { run_id: "11111111-1111-4111-8111-111111111111" } });
 * for await (const frame of runs.streamRunEvents({ path: { run_id: run.id } })) {
 *   console.log(frame.id, frame.event);
 * }
 * ```
 */

export {
  createRunsSdk,
  type RunsArgs,
  type RunsCallOptions,
  type RunsCredential,
  type RunsInput,
  type RunsOperationId,
  type RunsOutput,
  type RunsPaginatedOperationId,
  type RunsProblem,
  runsProblemOf,
  type RunsResult,
  type RunsSdk,
  type RunsSdkConfig,
  type RunsTransport,
  type RunStreamFrame,
} from "./client.ts";
export { RUNS_OPERATIONS, type RunsOperationRoute } from "./operations.ts";
export type {
  components as RunsContractComponents,
  operations as RunsContractOperations,
  paths as RunsContractPaths,
} from "../contract/runs-api.generated.ts";
