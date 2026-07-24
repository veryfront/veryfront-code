import type { CORSPreflightOptions } from "./types.ts";
import {
  corsOriginForTelemetry,
  normalizeCORSConfig,
  type NormalizedCORSConfig,
  snapshotCORSArray,
  validateNormalizedOrigin,
} from "./validators.ts";
import {
  DEFAULT_MAX_AGE,
  getDefaultCORSHeaders,
  getDefaultCORSMethods,
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
} from "./constants.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  isBoundedCorsTokenList,
  MAX_CORS_SERIALIZED_LIST_LENGTH,
  MAX_CORS_TOKEN_COUNT,
} from "#veryfront/utils/cors-policy-limits.ts";

const logger = serverLogger.component("cors");
const REJECTED_PREFLIGHT_BODY = "CORS request rejected";
const REJECTED_PREFLIGHT_HEADER = "CORS policy rejected";

interface ResolvePreflightPolicyOptions {
  config?: unknown;
  allowMethods?: unknown;
  allowHeaders?: unknown;
  requestedHeaders?: unknown;
}

interface ResolvedPreflightPolicy {
  methods: string;
  headers: string;
}

export function normalizeCORSPreflightList(value: unknown): string[] | null {
  try {
    if (typeof value === "string") {
      if (value.length > MAX_CORS_SERIALIZED_LIST_LENGTH) return null;
      const normalized = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
      return isBoundedCorsTokenList(normalized) ? normalized : null;
    }

    const values = snapshotCORSArray(value, MAX_CORS_TOKEN_COUNT);
    if (!values) return null;
    if (!values.every((item) => typeof item === "string")) return null;
    const normalized = [...new Set(values.map((item) => item.trim()).filter(Boolean))];
    return isBoundedCorsTokenList(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function intersectLists(
  policy: string[],
  capability: string[],
  normalize: (value: string) => string,
): string[] {
  const supported = new Set(capability.map(normalize));
  return policy.filter((value) => supported.has(normalize(value)));
}

/**
 * Resolve the headers advertised by a preflight response.
 *
 * Explicit allow lists describe runtime capabilities. Configured lists are
 * policy restrictions, so when both exist the response advertises only their
 * intersection. Request-supplied header names are reflected only when no
 * configured or explicit policy exists.
 */
function resolveNormalizedCORSPreflightPolicy(
  options: ResolvePreflightPolicyOptions,
  config: NormalizedCORSConfig,
): ResolvedPreflightPolicy {
  const corsConfig = typeof config === "object" ? config : undefined;

  const methodCapability = options.allowMethods === undefined
    ? undefined
    : normalizeCORSPreflightList(options.allowMethods) ?? [];
  const configuredMethodValues = corsConfig?.methods;
  const hasConfiguredMethods = configuredMethodValues !== undefined;
  const configuredMethods = hasConfiguredMethods
    ? normalizeCORSPreflightList(configuredMethodValues) ?? []
    : [];
  const methods = hasConfiguredMethods
    ? methodCapability
      ? intersectLists(configuredMethods, methodCapability, (value) => value)
      : configuredMethods
    : methodCapability ?? [...getDefaultCORSMethods()];

  const headerCapability = options.allowHeaders === undefined
    ? undefined
    : normalizeCORSPreflightList(options.allowHeaders) ?? [];
  const configuredHeaderValues = corsConfig?.allowedHeaders;
  const hasConfiguredHeaders = configuredHeaderValues !== undefined;
  const configuredHeaders = hasConfiguredHeaders
    ? normalizeCORSPreflightList(configuredHeaderValues) ?? []
    : [];
  const headers = hasConfiguredHeaders
    ? headerCapability
      ? intersectLists(configuredHeaders, headerCapability, (value) => value.toLowerCase())
      : configuredHeaders
    : headerCapability ??
      (options.requestedHeaders
        ? normalizeCORSPreflightList(options.requestedHeaders) ?? []
        : [...getDefaultCORSHeaders()]);

  return {
    methods: methods.join(", "),
    headers: headers.join(", "),
  };
}

export function resolveCORSPreflightPolicy(
  options: ResolvePreflightPolicyOptions,
): ResolvedPreflightPolicy {
  const normalized = normalizeCORSConfig(options.config);
  if (!normalized.valid) return { methods: "", headers: "" };
  return resolveNormalizedCORSPreflightPolicy(options, normalized.config);
}

export function handleCORSPreflight(options: CORSPreflightOptions): Promise<Response> {
  const observedOrigin = readRequestHeader(options.request, "origin");

  return withSpan(
    "security.cors.preflight",
    async () => {
      const { request, config, allowMethods, allowHeaders } = options;
      const normalized = normalizeCORSConfig(config);
      if (!normalized.valid) {
        return rejectedPreflight();
      }

      const origin = readRequestHeader(request, "origin");
      const validation = await validateNormalizedOrigin(origin, normalized.config);

      if (!validation.allowedOrigin) {
        if (normalized.config === false) {
          return new Response(null, { status: HTTP_NO_CONTENT });
        }

        logger.warn("Preflight rejected", {
          origin: corsOriginForTelemetry(origin),
          error: validation.error,
        });

        return rejectedPreflight();
      }

      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

      if (validation.allowedOrigin !== "*") {
        headers.set("Vary", "Origin");
      }

      const requestedHeaders = readRequestHeader(request, "access-control-request-headers");
      const policy = resolveNormalizedCORSPreflightPolicy({
        allowMethods,
        allowHeaders,
        requestedHeaders,
      }, normalized.config);
      if (policy.methods) headers.set("Access-Control-Allow-Methods", policy.methods);
      if (policy.headers) headers.set("Access-Control-Allow-Headers", policy.headers);

      const corsConfig = typeof normalized.config === "object" ? normalized.config : null;
      headers.set("Access-Control-Max-Age", String(corsConfig?.maxAge ?? DEFAULT_MAX_AGE));

      if (validation.allowCredentials && validation.allowedOrigin !== "*") {
        headers.set("Access-Control-Allow-Credentials", "true");
      }

      return new Response(null, {
        status: HTTP_NO_CONTENT,
        headers,
      });
    },
    { "cors.origin": corsOriginForTelemetry(observedOrigin) },
  );
}

export function isPreflightRequest(request: Request): boolean {
  try {
    return (
      request.method === "OPTIONS" &&
      (request.headers.has("access-control-request-method") ||
        request.headers.has("access-control-request-headers"))
    );
  } catch {
    return false;
  }
}

function rejectedPreflight(): Response {
  return new Response(REJECTED_PREFLIGHT_BODY, {
    status: HTTP_FORBIDDEN,
    headers: {
      "X-CORS-Error": REJECTED_PREFLIGHT_HEADER,
    },
  });
}

function readRequestHeader(request: Request, name: string): unknown {
  try {
    return request.headers.get(name);
  } catch {
    return undefined;
  }
}
