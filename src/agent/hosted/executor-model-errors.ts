import { parseProviderError } from "#veryfront/chat/provider-errors.ts";
import {
  CURATED_PROVIDER_FAILURE_CODES,
  curatedProviderFailure,
  type CuratedProviderFailureCode,
} from "#veryfront/chat/provider-error-registry.ts";
import { defineError, type VeryfrontError } from "#veryfront/errors/types.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";

export const getExecutorModelFailureSchema = defineSchema((v) =>
  v.object({
    type: v.literal("failure"),
    code: v.enum(CURATED_PROVIDER_FAILURE_CODES),
  }).strict()
);

/** No message, body, cause, provider status, or response headers enter the envelope. */
export function executorModelFailure(
  error: unknown,
): { type: "failure"; code: CuratedProviderFailureCode } | undefined {
  const code = parseProviderError(error).code;
  const allowed = CURATED_PROVIDER_FAILURE_CODES.find((value) => value === code);
  return allowed ? { type: "failure", code: allowed } : undefined;
}

/** Reconstruct the existing registered-error shape using fixed local diagnostics. */
export function createExecutorModelFailure(code: CuratedProviderFailureCode): VeryfrontError {
  const failure = curatedProviderFailure(code);
  return defineError({
    slug: code.toLowerCase().replaceAll("_", "-"),
    category: "AGENT",
    status: failure.status,
    title: failure.message,
  }).create();
}

/** Only the exact bounded model failure envelope has authority to classify a reply. */
export function throwExecutorModelFailure(value: unknown): void {
  const result = getExecutorModelFailureSchema().safeParse(value);
  if (result.success) throw createExecutorModelFailure(result.data.code);
}
