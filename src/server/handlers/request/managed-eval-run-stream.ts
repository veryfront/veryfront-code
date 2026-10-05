import { API_CLIENT_ERROR } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { CanonicalRunStreamFrame } from "#veryfront/runs/target/client.ts";
import { MAX_SSE_FRAME_CHARS, normalizeNewlines } from "#veryfront/utils/sse-frames.ts";

const getCanonicalFrameSchema = defineSchema((v) =>
  v.object({
    event_id: v.number().int().nonnegative().nullable(),
    event_type: v.string().min(1),
    payload: v.object({ type: v.string().min(1) }).passthrough(),
    is_error: v.boolean(),
    created_at: v.string().nullable(),
  }).strict()
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
