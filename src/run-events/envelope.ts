/**
 * The typed run event row: the span envelope every `format=typed` surface
 * carries, and the two row shapes the API serves it in.
 *
 * Field names are the REST snake_case ones, not the API's internal camelCase
 * domain fields, because this is what a consumer reads off the wire from
 * `GET /runs/{run_id}/events?format=typed`, the conversation-scoped events
 * route, and both `/stream` routes.
 *
 * @module run-events/envelope
 */

import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { defineRunEventSchema } from "./schema-validator.ts";
import { RUN_EVENT_CLASSES } from "./vocabulary.ts";

/**
 * The span envelope plus the row's own identity fields.
 *
 * `event_type` is an open non-empty string, not the catalogued enum. After the
 * cutover the API is free to add a type ahead of its consumers, and a reader
 * that rejected the whole row over an unrecognized name would drop history it
 * could otherwise show. Narrow it yourself with `isRunEventType` when you need
 * the closed set.
 *
 * `event_id` is null only for a live SSE frame that was never persisted (a
 * heartbeat, a synthetic terminal frame). Every stored row has one, and it is
 * the cursor value to resume from.
 */
export const getRunEventEnvelopeSchema = defineRunEventSchema((v) =>
  v.object({
    event_id: v.number().int().nonnegative().nullable(),
    event_type: v.string().min(1),
    run_id: v.string().min(1),
    event_class: v.enum(RUN_EVENT_CLASSES),
    span_id: v.string().min(1),
    parent_span_id: v.string().min(1).nullable(),
    turn_id: v.string().min(1).nullable(),
    origin_event_type: v.string().min(1),
    origin_custom_name: v.string().min(1).nullable(),
    unrecoverable_fields: v.array(v.string().min(1)),
    created_at: v.string().nullable(),
    is_error: v.boolean(),
  })
);

/** The span envelope and row identity fields of a typed run event. */
export type RunEventEnvelope = InferSchema<ReturnType<typeof getRunEventEnvelopeSchema>>;

/**
 * A typed run event row as `GET /runs/{run_id}/events?format=typed` and the
 * typed SSE frames serve it.
 *
 * The payload is checked only for its `type` discriminant here. A row whose
 * payload failed the API's own per-type validation still arrives with its type
 * intact and the failing field paths listed in `unrecoverable_fields` (the API
 * reports the damage rather than dropping the row), so validating the payload
 * strictly at this level would reject rows the contract says to keep. Use
 * `RUN_EVENT_PAYLOAD_SCHEMAS` or a per-type getter for the narrow check.
 */
export const getTypedRunEventRowSchema = defineRunEventSchema((v) =>
  getRunEventEnvelopeSchema().extend({
    payload: v.object({ type: v.string().min(1) }).passthrough(),
  })
);

/** A typed run event row keyed by `payload`. */
export type TypedRunEventRow = InferSchema<ReturnType<typeof getTypedRunEventRowSchema>>;

/**
 * The same row as the conversation-scoped surfaces serve it, where the payload
 * key is `event` rather than `payload`. GraphQL `agentRunEvents`, the MCP
 * `get_agent_run_events` tool, and
 * `GET /conversations/{conversation_id}/runs/{run_id}/events` all use this
 * spelling; the run-scoped route and the SSE frames use `payload`.
 */
// legacy: removed in Phase F -- the `event` key belongs to the pre-cutover conversation row.
export const getConversationTypedRunEventRowSchema = defineRunEventSchema((v) =>
  getRunEventEnvelopeSchema().extend({
    event: v.object({ type: v.string().min(1) }).passthrough(),
  })
);

/** A typed run event row keyed by `event`, as the conversation surfaces serve it. */
// legacy: removed in Phase F -- the `event` key belongs to the pre-cutover conversation row.
export type ConversationTypedRunEventRow = InferSchema<
  ReturnType<typeof getConversationTypedRunEventRowSchema>
>;

/**
 * Parse one typed run event row, throwing when it does not match the contract.
 *
 * Throwing is the right default for this boundary: a row that fails here is
 * the API and this package disagreeing about the contract, which is a bug to
 * surface rather than a value to skip. Call
 * `getTypedRunEventRowSchema().safeParse(input)` when you need to keep reading
 * past a bad row.
 *
 * @param input - One row from a typed run event surface.
 * @returns The parsed row.
 * @throws When the row is missing an envelope field or a typed payload.
 *
 * @example
 * ```ts
 * import { parseTypedRunEventRow } from "veryfront/run-events";
 *
 * const response = await fetch(`${apiUrl}/runs/${runId}/events?format=typed`);
 * const body = await response.json();
 * const rows = (body.data as unknown[]).map(parseTypedRunEventRow);
 * ```
 */
export function parseTypedRunEventRow(input: unknown): TypedRunEventRow {
  return getTypedRunEventRowSchema().parse(input);
}
