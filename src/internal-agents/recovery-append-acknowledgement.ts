import { defineSchema } from "#veryfront/schemas/index.ts";
import { getToolCallAdmissionWireReceiptSchema } from "#veryfront/runtime/tool-call-admission-receipt.ts";
import { cancelPrivateStream, getPrivateStreamReader } from "#veryfront/security/private-stream.ts";

const parseJson = JSON.parse;
const NativeTextDecoder = TextDecoder;
const NativeUint8Array = Uint8Array;
const apply = Reflect.apply;
const setBytes = Uint8Array.prototype.set;
const decode = TextDecoder.prototype.decode;
const byteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)!.get!;
const responseBody = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const responseOk = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!.get!;

/** This is an event persistence receipt, never proof of an external effect commit. */
export const getRecoveryAppendAcknowledgementSchema = defineSchema((v) =>
  v.object({
    run_id: v.string().uuid(),
    latest_event_id: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    latest_external_event_sequence: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    appended_count: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    acknowledged_event_ids: v.array(v.number().int().min(1).max(Number.MAX_SAFE_INTEGER)).max(100)
      .optional(),
    recovery_checkpoint: v.object({
      snapshot_event_id: v.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      snapshot_external_sequence: v.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      checkpoint_event_id: v.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    }).strict().optional(),
    model_call_captures: v.array(
      v.object({
        event_id: v.string().min(1),
        project_id: v.string().uuid(),
        run_id: v.string().uuid(),
        model_call_id: v.string().uuid(),
      }).strict(),
    ).optional(),
    tool_call_admissions: v.array(getToolCallAdmissionWireReceiptSchema()).min(1).max(100)
      .optional(),
  }).strict()
);
export type RecoveryAppendAcknowledgement = ReturnType<
  ReturnType<typeof getRecoveryAppendAcknowledgementSchema>["parse"]
>;

/** Bounded original HTTP response; does not use caller parsers or infer an external cursor. */
export async function readRecoveryAppendAcknowledgement(
  response: Response,
  canonicalRunId: string,
  knownPrivateExternalSequence?: number,
): Promise<RecoveryAppendAcknowledgement> {
  const body = apply(responseBody, response, []) as ReadableStream<Uint8Array> | null;
  if (!apply(responseOk, response, []) || !body) {
    if (body) await cancelPrivateStream(body).catch(() => {});
    throw new Error("Recovery append acknowledgement is unavailable");
  }
  const reader = getPrivateStreamReader(body);
  // A fixed buffer avoids shared array prototype access to private acknowledgement bytes.
  const bytes = new NativeUint8Array(65_536);
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const count = apply(byteLength, result.value, []) as number;
      if (size + count > 65_536) {
        throw new Error("Recovery append acknowledgement exceeds its bound");
      }
      apply(setBytes, bytes, [result.value, size]);
      size += count;
    }
    const exact = new NativeUint8Array(bytes.buffer, 0, size);
    const value = parseJson(
      apply(decode, new NativeTextDecoder("utf-8", { fatal: true }), [exact]),
    );
    const acknowledgement = getRecoveryAppendAcknowledgementSchema().parse(
      knownPrivateExternalSequence !== undefined && value !== null && typeof value === "object" &&
        !("latest_external_event_sequence" in value)
        ? { ...value, latest_external_event_sequence: knownPrivateExternalSequence }
        : value,
    );
    if (acknowledgement.run_id !== canonicalRunId) {
      throw new Error("Recovery append acknowledgement has a foreign run");
    }
    return acknowledgement;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
