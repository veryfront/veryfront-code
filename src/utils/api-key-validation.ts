import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export function requireApiKey(
  providerName: string,
  apiKey: string | undefined,
  errorType: "agent" | "config",
): void {
  if (apiKey) return;

  throw toError(
    createError({
      type: errorType,
      message: `${providerName}: API key is required`,
    }),
  );
}
