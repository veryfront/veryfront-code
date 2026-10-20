/**
 * Typed SDK for the Runs target contract, with the pinned contract's operation, input and
 * output types, and the canonical Veryfront API transport it sends requests through. The
 * legacy client stays at `veryfront/runs` until the cutover removes it.
 *
 * @module
 *
 * @example
 * ```ts
 * import { createRunsApiTransport, createRunsSdk, type RunsOutput } from "veryfront/runs/target";
 *
 * const runs = createRunsSdk({
 *   transport: createRunsApiTransport({
 *     baseUrl: "<RUNS_API_ORIGIN>",
 *     getToken: () => process.env.VERYFRONT_API_TOKEN!,
 *   }),
 * });
 *
 * const run: RunsOutput<"getRun"> = await runs.getRun({ path: { run_id: "11111111-1111-4111-8111-111111111111" } });
 * for await (const frame of runs.streamRunEvents({ path: { run_id: run.id } })) {
 *   console.log(frame.id, frame.event);
 * }
 * ```
 */

export {
  type CanonicalRunStreamFrame,
  createRunsSdk,
  type RunsArgs,
  type RunsArtifactInput,
  type RunsCallOptions,
  type RunsDeleteAcknowledgement,
  type RunsInput,
  type RunsOperationId,
  type RunsOutput,
  type RunsPaginatedOperationId,
  type RunsProblem,
  runsProblemOf,
  type RunsResult,
  type RunsSdk,
  type RunsSdkConfig,
  type RunStreamFrame,
} from "./client.ts";
export { createRunsApiTransport, type RunsApiTransportOptions } from "./transport.ts";
export type {
  TransportRequestInit,
  TransportRetryConfig,
  VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
export { RUNS_OPERATIONS, type RunsOperationRoute } from "./operations.ts";
import type { components, operations, paths } from "../contract/runs-api.generated.ts";

/** Schemas of the pinned Runs contract, for example `RunsContractComponents["schemas"]["Run"]`. */
export type RunsContractComponents = components;
/** Operations of the pinned Runs contract, keyed by operation ID. */
export type RunsContractOperations = operations;
/** Paths of the pinned Runs contract, keyed by URL template. */
export type RunsContractPaths = paths;

export {
  CanonicalEventsV1Error,
  type CanonicalEventsV1Facade,
  type CanonicalEventsV1ListOptions,
  CanonicalEventsV1StreamError,
  createCanonicalEventsV1Facade,
} from "./canonical-v1.ts";
export {
  type CanonicalEventV1,
  type CanonicalMemberV1,
  decodeDescendantCursorV1,
  type DescendantCursorV1,
  type DescendantRunReadPageV1,
  type EventDiscoveryV1,
  type EventViewV1,
  type LegacyMemberV1,
  type LegacyReasonV1,
  parseDescendantRunReadPageV1,
  parseEventDiscoveryV1,
  parseEventErrorV1,
  parseRunReadMemberV1,
  parseRunReadPageV1,
  parseStreamMemberV1,
  type RunReadMemberV1,
  type RunReadMetadataV1,
  type RunReadPageV1,
  type StreamMemberV1,
  type TransientMemberV1,
} from "#veryfront/events/canonical-v1/index.ts";
