import { PAGE_NOT_FOUND } from "#veryfront/errors/error-registry.ts";
import { createErrorResponse } from "#veryfront/errors/http-error.ts";

export function createDevNotFoundResponse(): Response {
  const error = PAGE_NOT_FOUND.create({
    detail: "The requested resource was not found",
  });
  return createErrorResponse(error);
}
