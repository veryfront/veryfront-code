import type { DiscoveryResult } from "#veryfront/discovery";
import { getErrorMessage, INITIALIZATION_ERROR } from "#veryfront/errors";

/** Reject an incomplete primitive generation before a server starts serving it. */
export function assertPrimitiveDiscoverySucceeded(
  result: Pick<DiscoveryResult, "errors">,
): void {
  if (result.errors.length === 0) return;

  const first = result.errors[0];
  const count = result.errors.length;
  throw INITIALIZATION_ERROR.create({
    detail: `Primitive discovery failed for ${count} definition${count === 1 ? "" : "s"}. ` +
      `First failure: ${first?.file ?? "unknown source"}: ${
        first ? getErrorMessage(first.error) : "unknown error"
      }`,
    cause: first?.error,
  });
}
