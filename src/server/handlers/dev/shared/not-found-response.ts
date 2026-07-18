import { createErrorResponse, PAGE_NOT_FOUND } from "#veryfront/errors";

export function createDevNotFoundResponse(): Response {
  const error = PAGE_NOT_FOUND.create({
    detail: "The requested resource was not found",
  });
  return createErrorResponse(error);
}
