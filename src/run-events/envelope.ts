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

import type {
  InferSchema,
  RefinementCtx,
  Schema,
  ValidationResult,
} from "#veryfront/extensions/schema/index.ts";
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

/**
 * A conversation-scoped row as the API serves it, before
 * `getConversationTypedRunEventRowSchema` collapses its two keys into one:
 * keyed `payload`, or, until Phase F, by the `event` alias. Annotate a row you
 * build by hand (a fixture, a stub server) with this type and parse it to get
 * a `ConversationTypedRunEventRow`. A row with neither key, or an alias-only
 * row whose alias is not a typed payload, is not assignable to it, matching
 * what the schema rejects.
 *
 * Beside a canonical `payload` the alias is unchecked: the schema validates
 * `event` only when it is the row's one payload, so a stale or malformed
 * alias next to a canonical payload still parses.
 */
export type ConversationTypedRunEventRowInput =
  | (RunEventEnvelope & {
    payload: TypedRunEventPayload;
    /** @deprecated Serve `payload` only. Removed in Phase F. */
    event?: unknown;
  })
  | (RunEventEnvelope & {
    payload?: undefined;
    /** @deprecated Serve `payload` instead. Removed in Phase F. */
    event: TypedRunEventPayload;
  });

/**
 * The row as the object schema hands it to the refinement, where both keys
 * are still optional: the union above is what a consumer builds, this is what
 * the validator has established so far.
 */
type LooseConversationTypedRunEventRow = RunEventEnvelope & {
  payload?: TypedRunEventPayload;
  event?: unknown;
};

/**
 * The one payload a conversation-scoped row carries. `payload` is canonical
 * and wins when a row somehow carries both, without looking at the alias;
 * `event` is the transitional alias and is validated as a typed payload only
 * when it is all the row has. Returns undefined when the row has neither,
 * which the schema rejects.
 */
function pickConversationPayload(
  typedPayload: Schema<TypedRunEventPayload>,
  row: LooseConversationTypedRunEventRow,
): { key: "payload" | "event"; result: ValidationResult<TypedRunEventPayload> } | undefined {
  if (row.payload !== undefined) {
    return { key: "payload", result: { success: true, data: row.payload } };
  }
  if (row.event !== undefined) {
    return { key: "event", result: typedPayload.safeParse(row.event) };
  }
  return undefined;
}

/**
 * The same row as the conversation-scoped surfaces serve it: GraphQL
 * `agentRunEvents`, the MCP `get_agent_run_events` tool, and
 * `GET /conversations/{conversation_id}/runs/{run_id}/events`. Since the
 * cutover every one of them keys the payload as `payload`, the same spelling
 * as the run-scoped route and the SSE frames, so this schema reads `payload`
 * as canonical and accepts the pre-cutover `event` key as a transitional
 * alias that Phase F removes. At least one of the two must be present: a row
 * with both parses as `payload` and never looks at the alias, so a stale or
 * malformed alias beside a canonical payload does not reject the row; a row
 * with neither is rejected with an issue naming both keys.
 *
 * The `type` agreement and `event_class` checks run against whichever object
 * was chosen, exactly as `getTypedRunEventRowSchema` runs them. The parsed row
 * exposes that object under `payload` and, for compatibility until Phase F,
 * under the deprecated `event` alias; read `payload`.
 *
 * `format=typed` is accepted and ignored on these surfaces (it is deprecated),
 * and any other value, including `format=raw`, is refused. Do not send it.
 *
 * Because the parsed row is normalized, this is not an object schema: its
 * output differs from its input, so the object chainables (`extend`, `pick`,
 * `strict`) do not apply to it. To compose a row schema of your own, start
 * from `getRunEventEnvelopeSchema()` and the `ConversationTypedRunEventRowInput`
 * shape, or compose `getTypedRunEventRowSchema()` for a `payload`-keyed row.
 */
// legacy: removed in Phase F -- the `event` alias goes; `payload` stays as the only key.
export const getConversationTypedRunEventRowSchema = defineRunEventSchema((v) => {
  const typedPayload = v.object({ type: v.string().min(1) }).passthrough();
  return getRunEventEnvelopeSchema().extend({
    payload: typedPayload.optional(),
    // Not validated at the object level: see `pickConversationPayload`.
    event: v.unknown().optional(),
  }).superRefine((row, ctx) => {
    const chosen = pickConversationPayload(typedPayload, row);
    if (chosen === undefined) {
      ctx.addIssue({
        message:
          'a conversation run event row needs a "payload" (canonical) or "event" (alias) object',
        path: ["payload"],
      });
      return;
    }
    if (!chosen.result.success) {
      for (const issue of chosen.result.issues) {
        ctx.addIssue({
          code: issue.code,
          message: issue.message,
          path: [chosen.key, ...issue.path],
        });
      }
      return;
    }
    const payload = chosen.result.data;
    if (row.event_type !== payload.type) {
      ctx.addIssue({
        message:
          `${chosen.key}.type "${payload.type}" does not match event_type "${row.event_type}"`,
        path: [chosen.key, "type"],
      });
    }
    checkEventClassAgreesWithType(row, ctx);
  }).transform((row): ConversationTypedRunEventRow => {
    const { payload: _payload, event: _event, ...envelope } = row;
    // A second pick re-validates an alias-keyed row's small payload object;
    // the refinement cannot hand its result forward.
    const chosen = pickConversationPayload(typedPayload, row);
    if (chosen === undefined || !chosen.result.success) {
      // The refinement above already rejected this row; a validator that ran
      // the transform anyway would be a contract bug worth surfacing.
      throw new Error("conversation run event row reached the transform without a payload");
    }
    return { ...envelope, payload: chosen.result.data, event: chosen.result.data };
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
