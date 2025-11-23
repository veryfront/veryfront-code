import { serverLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { HTTP_INTERNAL_SERVER_ERROR } from "@veryfront/utils";
import { getEnvironmentVariable } from "@veryfront/utils";

export function handleAPIError(
  error: unknown,
  pathname: string,
  adapter: RuntimeAdapter,
): Response {
  logger.error(`API route error in ${pathname}:`, error);

  const envFromAdapter = adapter.env.get("MODE") ??
    adapter.env.get("NODE_ENV") ??
    adapter.env.get("DENO_ENV");
  const envFromRuntime = getEnvironmentVariable("MODE") ??
    getEnvironmentVariable("NODE_ENV") ??
    getEnvironmentVariable("DENO_ENV");
  const environment = (envFromAdapter ?? envFromRuntime ?? "development").toLowerCase();
  const isDevelopment = environment === "development" || environment === "dev";

  if (isDevelopment) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: HTTP_INTERNAL_SERVER_ERROR },
    );
  }

  return new Response("Internal server error", {
    status: HTTP_INTERNAL_SERVER_ERROR,
  });
}
