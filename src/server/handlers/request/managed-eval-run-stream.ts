import { API_CLIENT_ERROR } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { CanonicalRunStreamFrame } from "#veryfront/runs/target/client.ts";
import { getRunEventEnvelopeSchema } from "#veryfront/run-events/envelope.ts";
import { MAX_SSE_FRAME_CHARS, normalizeNewlines } from "#veryfront/utils/sse-frames.ts";

/**
 * One `RunStreamFrame` as the Runs API publishes it. The five base fields are required and
 * are what this adapter reads. The run event envelope fields (`run_id`, `event_class`,
 * `span_id`, ...) are optional in the published contract; when present they must match the
 * run event envelope. Fields the contract adds later are dropped, not rejected, because the
 * API extends the frame additively.
 *
 * This checks field shapes only. It does not apply the `event_class` and `event_type` agreement
 * check of `getTypedRunEventRowSchema`, because the adapter forwards only the payload and must
 * not fail an eval over a classification it never reads. `getRunEventEnvelopeSchema` is a plain
 * object schema built through the same `defineSchema` registry, so composing it here is safe;
 * the tests in `managed-eval-run-stream.test.ts` fail if it gains a refinement that breaks
 * `.partial()` or `.extend()`.
 */
const getCanonicalFrameSchema = defineSchema((v) =>
  getRunEventEnvelopeSchema().partial().extend({
    event_id: v.number().int().nonnegative().nullable(),
    event_type: v.string().min(1),
    payload: v.object({ type: v.string().min(1) }).passthrough(),
    is_error: v.boolean(),
    created_at: v.string().nullable(),
  }).strip()
);

function invalidFrame(): never {
  throw API_CLIENT_ERROR.create({
    detail: "Invalid canonical managed eval stream frame",
    status: 502,
  });
}

function unpackFrame(raw: string): string {
  if (raw.length > MAX_SSE_FRAME_CHARS) invalidFrame();
  const lines = normalizeNewlines(raw).split("\n");
  const values = (field: string) =>
    lines.filter((line) => line.startsWith(`${field}:`))
      .map((line) => line.slice(field.length + 1).replace(/^ /, ""));
  const data = values("data");
  if (data.length === 0) return `${normalizeNewlines(raw)}\n\n`;
  let value: unknown;
  try {
    value = JSON.parse(data.join("\n"));
  } catch {
    invalidFrame();
  }
  const parsed = getCanonicalFrameSchema().safeParse(value);
  if (!parsed.success) invalidFrame();
  const frame: CanonicalRunStreamFrame = parsed.data;
  const event = values("event").at(-1);
  const id = values("id").at(-1);
  if (
    frame.payload.type !== frame.event_type ||
    (event !== undefined && event !== frame.event_type) ||
    (id !== undefined && id !== String(frame.event_id))
  ) invalidFrame();
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${frame.event_type}\ndata: ${
    JSON.stringify(frame.payload)
  }\n\n`;
}

/** Convert the canonical Runs stream into AG-UI for the managed eval consumer. */
export function adaptManagedEvalRunStream(response: Response): Response {
  if (!response.body) invalidFrame();
  let buffer = "";
  const encoder = new TextEncoder();
  const body = response.body.pipeThrough(new TextDecoderStream("utf-8", { fatal: true }))
    .pipeThrough(
      new TransformStream<string, Uint8Array>({
        transform(chunk, controller) {
          buffer += chunk;
          let separator: RegExpExecArray | null;
          while ((separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer)) !== null) {
            controller.enqueue(encoder.encode(unpackFrame(buffer.slice(0, separator.index))));
            buffer = buffer.slice(separator.index + separator[0].length);
          }
          if (buffer.length > MAX_SSE_FRAME_CHARS) invalidFrame();
        },
        flush(controller) {
          if (buffer.trim()) controller.enqueue(encoder.encode(unpackFrame(buffer)));
        },
      }),
    );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: { "Content-Type": "text/event-stream" },
  });
}
