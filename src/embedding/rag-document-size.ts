import { INVALID_ARGUMENT } from "#veryfront/errors";

export function validateRagDocumentSize(size: number | undefined): void {
  if (size === undefined) return;
  if (Number.isInteger(size) && size >= 0) return;

  throw INVALID_ARGUMENT.create({
    detail: "RAG document size must be a non-negative integer",
  });
}
