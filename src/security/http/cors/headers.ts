import type {
  CORSConfig,
  CORSHeaderOptions,
  CORSValidationResult,
  SyncCORSHeaderOptions,
} from "./types.ts";
import {
  corsOriginForTelemetry,
  normalizeCORSConfig,
  type NormalizedCORSConfig,
  validateNormalizedOrigin,
  validateNormalizedOriginSync,
} from "./validators.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isCorsPolicyResponseHeaderName } from "#veryfront/utils/cors-policy-limits.ts";

export function scrubPolicyOwnedCORSHeaders(headers: Headers): boolean {
  let changed = false;
  for (const name of [...headers.keys()]) {
    if (!isCorsPolicyResponseHeaderName(name)) continue;
    headers.delete(name);
    changed = true;
  }
  return changed;
}

function applyValidatedHeaders(
  validation: CORSValidationResult,
  options: CORSHeaderOptions | SyncCORSHeaderOptions,
  config: NormalizedCORSConfig,
): Response | void {
  const { response, headers: headersObj } = options;
  const headers = headersObj ?? (response ? new Headers(response.headers) : new Headers());

  if (!validation.allowedOrigin) {
    const changed = scrubPolicyOwnedCORSHeaders(headers);

    if (!response) return;
    if (!headersObj && !changed) return response;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  scrubPolicyOwnedCORSHeaders(headers);
  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

  if (validation.allowedOrigin !== "*") {
    const varyValues = headers
      .get("Vary")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];

    if (
      !varyValues.some((value) => value === "*" || value.toLowerCase() === "origin")
    ) {
      headers.set("Vary", [...varyValues, "Origin"].join(", "));
    }
  }

  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  } else headers.delete("Access-Control-Allow-Credentials");

  const corsConfig = typeof config === "object" ? config : null;
  if (corsConfig?.exposedHeaders?.length) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
  } else {
    headers.delete("Access-Control-Expose-Headers");
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
  const normalized = normalizeCORSConfig(options.config);
  const origin = readRequestOrigin(options.request);

  return withSpan(
    "security.cors.applyHeaders",
    async () => {
      if (!normalized.valid) {
        return applyValidatedHeaders(
          Object.freeze({
            allowedOrigin: null,
            allowCredentials: false,
            error: normalized.error,
          }),
          options,
          false,
        );
      }
      const validation = await validateNormalizedOrigin(origin, normalized.config);
      return applyValidatedHeaders(validation, options, normalized.config);
    },
    { "cors.origin": corsOriginForTelemetry(origin) },
  );
}

/** Apply CORS synchronously. Promise-returning values still fail closed at runtime. */
export function applyCORSHeadersSync(options: SyncCORSHeaderOptions): Response | void {
  const normalized = normalizeCORSConfig(options.config);
  const origin = readRequestOrigin(options.request);
  if (!normalized.valid) {
    return applyValidatedHeaders(
      Object.freeze({
        allowedOrigin: null,
        allowCredentials: false,
        error: normalized.error,
      }),
      options,
      false,
    );
  }
  const validation = validateNormalizedOriginSync(origin, normalized.config);
  return applyValidatedHeaders(validation, options, normalized.config);
}

export function shouldApplyCORS(request: Request, config?: boolean | CORSConfig): boolean {
  const normalized = normalizeCORSConfig(config);
  if (!normalized.valid || normalized.config === false) return false;
  if (normalized.config === true) return true;

  const origin = readRequestOrigin(request);
  return typeof origin === "string" ? true : normalized.config.origin === "*";
}

function readRequestOrigin(request: Request): unknown {
  try {
    return request.headers.get("origin");
  } catch {
    return undefined;
  }
}
