import { getMessageSchema } from "#veryfront/agent/schemas/agent.schema.ts";
import { privateSha256Hex } from "#veryfront/security/private-sha256.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { snapshotDurableValue } from "./durable-run-home-schema.ts";

/** Immutable data provenance only; history never confers current-run effect authority. */
export function recoveryHistoryMessageDigest(
  message: { id: string; role: string; parts: unknown },
) {
  const normalized = getMessageSchema().omit({ metadata: true }).strict().parse({
    id: message.id,
    role: message.role,
    parts: message.parts,
  });
  return privateSha256Hex(privateJsonStringify(snapshotDurableValue({
    id: message.id,
    role: message.role,
    parts: normalized.parts,
  })));
}
