import { normalizeAgUiRuntimeMessages } from "#veryfront/agent/ag-ui/runtime-support.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { mapPrivateArray } from "#veryfront/security/private-array.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import type { RecoveryAdmission } from "./recovery-admission-schema.ts";
import { MAX_RECOVERY_CHECKPOINT_BYTES } from "./recovery-checkpoint-contract.ts";
import { type InternalAgentStreamRequest, toRuntimeRunAgentInput } from "./schema.ts";

// Leave room for the native continuation flags, usage, checkpoint wrapper and
// source-defined tool exposure. This bounds incoming history, not arbitrary
// source configuration or subsequent generated model/tool output.
const INITIAL_CHECKPOINT_RESERVE_BYTES = 32 * 1024;

/** Reject unsupported managed history before source preparation or ownership acquisition. */
export function assertManagedRecoveryAdmissionSize(
  input: InternalAgentStreamRequest,
  admission: RecoveryAdmission,
): void {
  const runtimeInput = toRuntimeRunAgentInput(input);
  const normalized = normalizeAgUiRuntimeMessages(runtimeInput.messages);
  const messages = mapPrivateArray(normalized, ({ id, role, parts }) => ({ id, role, parts }));
  const ids = mapPrivateArray(messages, (message) => message.id);
  const historyBytes = utf8ByteLength(privateJsonStringify({
    binding: {
      identity: admission.identity,
      generation: admission.generation,
      sourceBinding: admission.sourceBinding,
    },
    messages,
    runtimeContinuation: { messages },
    initialHistoryMessageIds: ids,
    // SHA256 hex digests have exactly 64 ASCII bytes, independent of content.
    initialHistoryMessageDigests: mapPrivateArray(ids, () => "0".repeat(64)),
    // Charge original fields as well, including metadata, attachment aliases,
    // JSON-encoded tool arguments/results and provider replay input. This
    // reserves their normalization/replay overhead in addition to both copies
    // of the transcript above.
    incomingMessages: input.messages,
    initialHistoryProviderReplayCheckpoints: input.serverResolvedProviderReplayCheckpoints,
    providerMetadata: input.serverResolvedProviderReplayCheckpoints,
  }));
  // Provider roundtripping can add part/message wrappers and assign UUIDs to
  // split messages. Keep per-part room independently of text/JSON byte length.
  let conversionBytes = 0;
  for (const message of messages) conversionBytes += 512 + message.parts.length * 256;
  if (
    historyBytes + conversionBytes + INITIAL_CHECKPOINT_RESERVE_BYTES >
      MAX_RECOVERY_CHECKPOINT_BYTES
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Managed recovery history exceeds its checkpoint size limit",
    });
  }
}
