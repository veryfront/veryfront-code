import { VeryfrontError } from "#veryfront/errors";

export function embeddingFailureContext(
  error: unknown,
): { errorKind: "veryfront"; slug: string; status: number } | { errorKind: "unknown" } {
  return error instanceof VeryfrontError
    ? { errorKind: "veryfront", slug: error.slug, status: error.status }
    : { errorKind: "unknown" };
}
