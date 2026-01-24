import type { CORSConfig, CORSHeaderOptions, CORSValidationResult } from "./types.ts";
import { validateOrigin, validateOriginSync } from "./validators.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

function applyValidatedHeaders(
  validation: CORSValidationResult,
  options: CORSHeaderOptions,
): Response | void {
  const { response, headers: headersObj, config } = options;

  if (!validation.allowedOrigin) {
    return response;
  }

  const headers = headersObj ?? (response ? new Headers(response.headers) : new Headers());

  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

  if (validation.allowedOrigin !== "*") {
    const varyValues = headers
      .get("Vary")
      ?.split(",")
      .map((v) => v.trim()) ?? [];

    if (!varyValues.includes("Origin")) {
      varyValues.push("Origin");
      headers.set("Vary", varyValues.join(", "));
    }
  }

  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  const corsConfig = typeof config === "object" ? config : null;
  if (corsConfig?.exposedHeaders?.length) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
  }

  if (!response) {
    return;
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function applyCORSHeaders(options: CORSHeaderOptions): Promise<Response | void> {
  const origin = options.request.headers.get("origin");

  return withSpan(
    "security.cors.applyHeaders",
    async () => {
      const validation = await validateOrigin(origin, options.config);
      return applyValidatedHeaders(validation, options);
    },
    { "cors.origin": origin ?? "unknown" },
  );
}

export function applyCORSHeadersSync(options: CORSHeaderOptions): Response | void {
  const validation = validateOriginSync(options.request.headers.get("origin"), options.config);
  return applyValidatedHeaders(validation, options);
}

export function shouldApplyCORS(request: Request, config?: boolean | CORSConfig): boolean {
  if (!config) {
    return false;
  }

  if (config === true) {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return config.origin === "*";
  }

  return true;
}
