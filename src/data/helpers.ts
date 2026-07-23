import type { DataResult } from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isValidRedirectDestination } from "./schemas/data.schema.ts";

/** Return a redirect result from a data loader. */
export function redirect(destination: string, permanent = false): DataResult {
  if (!isValidRedirectDestination(destination)) {
    throw INVALID_ARGUMENT.create({
      detail:
        "Redirect destination must be application-relative or use HTTP or HTTPS, with at most 8192 bytes",
    });
  }
  if (typeof permanent !== "boolean") {
    throw INVALID_ARGUMENT.create({
      detail: "Redirect permanent must be a boolean",
    });
  }
  return { redirect: { destination, permanent } };
}

/** Return a 404 result from a data loader. */
export function notFound(): DataResult {
  return { notFound: true };
}
