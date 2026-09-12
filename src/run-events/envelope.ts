/**
 * The typed run event row: the span envelope every run event surface
 * carries, and the row shape the API serves it in.
 *
 * Field names are the REST snake_case ones, not the API's internal camelCase
 * domain fields, because this is what a consumer reads off the wire from
 * `GET /runs/{run_id}/events`, the conversation-scoped events route, and
 * both `/stream` routes.
 *
 * @module run-events/envelope
 */

import type { InferSchema, RefinementCtx } from "#veryfront/extensions/schema/index.ts";
import { defineRunEventSchema } from "./schema-validator.ts";
import { isRunEventType, RUN_EVENT_CLASS_BY_TYPE, RUN_EVENT_CLASSES } from "./vocabulary.ts";

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
 * Flags a row whose `event_class` disagrees with the one class its
 * catalogued `event_type` is served with. An uncatalogued type has no entry
 * in `RUN_EVENT_CLASS_BY_TYPE` and is skipped: the API's post-cutover rule
 * leaves `event_type` open, so a type this vocabulary has not learned yet may
 * carry any class.
 */
function checkEventClassAgreesWithType(
  row: Pick<RunEventEnvelope, "event_type" | "event_class">,
  ctx: RefinementCtx,
) {
  if (!isRunEventType(row.event_type)) return;
  const expectedClass = RUN_EVENT_CLASS_BY_TYPE[row.event_type];
  if (row.event_class !== expectedClass) {
    ctx.addIssue({
      message:
        `event_class "${row.event_class}" does not match the class "${expectedClass}" for event_type "${row.event_type}"`,
      path: ["event_class"],
    });
  }
}

/**
 * A typed run event row as `GET /runs/{run_id}/events` and the typed SSE
 * frames serve it.
 *
 * The payload is checked only for its `type` discriminant here. A row whose
 * payload failed the API's own per-type validation still arrives with its type
 * intact and the failing field paths listed in `unrecoverable_fields` (the API
 * reports the damage rather than dropping the row), so validating the payload
 * strictly at this level would reject rows the contract says to keep. Use
 * `RUN_EVENT_PAYLOAD_SCHEMAS` or a per-type getter for the narrow check.
 *
 * `payload.type` always agrees with `event_type`: the API's own typed-event
 * contract requires the field and keeps it in sync with the envelope's type
 * before a row is ever served, so a row where they disagree is malformed
 * input, not a variant to tolerate. Rejecting that disagreement here means a
 * consumer never has to choose which discriminant to trust.
 *
 * `event_class` is checked the same way against `RUN_EVENT_CLASS_BY_TYPE`
 * for a catalogued `event_type`: the API assigns each catalogued type
 * exactly one class, so a row claiming a different one is malformed input. An
 * uncatalogued type is not checked, since `event_type` stays open post-cutover.
 */
export const getTypedRunEventRowSchema = defineRunEventSchema((v) =>
  getRunEventEnvelopeSchema().extend({
    payload: v.object({ type: v.string().min(1) }).passthrough(),
  }).superRefine((row, ctx) => {
    if (row.event_type !== row.payload.type) {
      ctx.addIssue({
        message: `payload.type "${row.payload.type}" does not match event_type "${row.event_type}"`,
        path: ["payload", "type"],
      });
    }
    checkEventClassAgreesWithType(row, ctx);
  })
);

/** A typed run event row keyed by `payload`. */
export type TypedRunEventRow = InferSchema<ReturnType<typeof getTypedRunEventRowSchema>>;

/** The typed payload of a row: its `type` discriminant plus whatever else the API served. */
type TypedRunEventPayload = TypedRunEventRow["payload"];

/**
 * The parsed conversation-scoped row: the envelope plus the row's one payload,
 * reachable as `payload` and, until Phase F, as the `event` alias.
 */
export type ConversationTypedRunEventRow = RunEventEnvelope & {
  /** The row's typed payload, whichever key the API served it under. */
  payload: TypedRunEventPayload;
  /**
   * The same object as `payload`, kept so a reader written against the
   * pre-cutover `event` key keeps working until Phase F removes the alias.
   *
   * @deprecated Read `payload`. Removed in Phase F.
   */
  event: TypedRunEventPayload;
};

/** The conversation row as it arrives, before the two keys collapse into one. */
type ConversationTypedRunEventRowInput = RunEventEnvelope & {
  payload?: TypedRunEventPayload;
  event?: TypedRunEventPayload;
};

/**
 * The one payload a conversation-scoped row carries. `payload` is canonical
 * and wins when a row somehow carries both; `event` is the transitional alias.
 * Returns undefined when the row has neither, which the schema rejects.
 */
function pickConversationPayload(
  row: ConversationTypedRunEventRowInput,
): { key: "payload" | "event"; payload: TypedRunEventPayload } | undefined {
  if (row.payload !== undefined) return { key: "payload", payload: row.payload };
  if (row.event !== undefined) return { key: "event", payload: row.event };
  return undefined;
}

/**
 * The same row as the conversation-scoped surfaces serve it: GraphQL
 * `agentRunEvents`, the MCP `get_agent_run_events` tool, and
 * `GET /conversations/{conversation_id}/runs/{run_id}/events`. Since the
 * cutover every one of them keys the payload as `payload`, the same spelling
 * as the run-scoped route and the SSE frames, so this schema reads `payload`
 * as canonical and accepts the pre-cutover `event` key as a transitional
 * alias that Phase F removes. Exactly one of the two must be present: a row
 * with both parses as `payload`, a row with neither is rejected with an issue
 * naming both keys.
 *
 * The `type` agreement and `event_class` checks run against whichever object
 * was chosen, exactly as `getTypedRunEventRowSchema` runs them. The parsed row
 * exposes that object under `payload` and, for compatibility until Phase F,
 * under the deprecated `event` alias; read `payload`.
 *
 * `format=typed` is accepted and ignored on these surfaces (it is deprecated),
 * and any other value, including `format=raw`, is refused. Do not send it.
 */
// legacy: removed in Phase F -- the `event` alias goes; `payload` stays as the only key.
export const getConversationTypedRunEventRowSchema = defineRunEventSchema((v) => {
  const typedPayload = v.object({ type: v.string().min(1) }).passthrough();
  return getRunEventEnvelopeSchema().extend({
    payload: typedPayload.optional(),
    event: typedPayload.optional(),
  }).superRefine((row, ctx) => {
    const chosen = pickConversationPayload(row);
    if (chosen === undefined) {
      ctx.addIssue({
        message:
          'a conversation run event row needs a "payload" (canonical) or "event" (alias) object',
        path: ["payload"],
      });
      return;
    }
    if (row.event_type !== chosen.payload.type) {
      ctx.addIssue({
        message:
          `${chosen.key}.type "${chosen.payload.type}" does not match event_type "${row.event_type}"`,
        path: [chosen.key, "type"],
      });
    }
    checkEventClassAgreesWithType(row, ctx);
  }).transform((row): ConversationTypedRunEventRow => {
    const { payload: _payload, event: _event, ...envelope } = row;
    const chosen = pickConversationPayload(row);
    if (chosen === undefined) {
      // The refinement above already rejected this row; a validator that ran
      // the transform anyway would be a contract bug worth surfacing.
      throw new Error("conversation run event row reached the transform with no payload");
    }
    return { ...envelope, payload: chosen.payload, event: chosen.payload };
  });
});

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
 * import { register, tryResolve } from "veryfront/extensions/contracts";
 * import { createZodAdapter } from "@veryfront/ext-schema-zod";
 * import { parseTypedRunEventRow } from "veryfront/run-events";
 *
 * // Register a validator only when nothing has (inside a Veryfront app,
 * // bootstrap already owns one and this leaves it in place).
 * if (!tryResolve("SchemaValidator")) {
 *   register("SchemaValidator", createZodAdapter());
 * }
 *
 * const apiUrl = "https://api.veryfront.example";
 * const runId = "<RUN_ID>";
 * const token = "<TOKEN>";
 *
 * const response = await fetch(`${apiUrl}/runs/${runId}/events`, {
 *   headers: { Authorization: `Bearer ${token}` },
 * });
 * const body = await response.json();
 * const rows = (body.data as unknown[]).map(parseTypedRunEventRow);
 * ```
 */
export function parseTypedRunEventRow(input: unknown): TypedRunEventRow {
  return getTypedRunEventRowSchema().parse(input);
}
