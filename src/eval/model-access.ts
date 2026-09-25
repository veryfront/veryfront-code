import {
  EVAL_INFERENCE_POLICY_DENIED,
  EVAL_MODEL_ACCESS_DENIED,
  EVAL_MODEL_EGRESS_BLOCKED,
  EVAL_MODEL_INFERENCE_POLICY_DENIED,
  EVAL_MODEL_PROJECT_ACCESS_DENIED,
  EVAL_MODEL_SPEND_LIMIT_EXCEEDED,
  EVAL_MODEL_UNAUTHORIZED,
  EVAL_PROJECT_REQUIRED,
  VeryfrontError,
} from "#veryfront/errors";
import { parseGatewayProblemBody, parseKnownProblemBody } from "#veryfront/chat/provider-errors.ts";
import {
  curatedProviderFailure,
  type CuratedProviderFailureCode,
  registeredProviderFailure,
} from "#veryfront/chat/provider-error-registry.ts";
import {
  getModelRequestTransportFailureUrl,
  isVeryfrontGatewayTransportFailure,
  ProviderError,
} from "#veryfront/provider/runtime-loader/provider-http.ts";
import { OutboundRequestBlockedError } from "#veryfront/security/http/outbound-fetch.ts";
import { isPrivateAddressEgressBlock } from "#veryfront/security/sandbox/worker-egress-guard.ts";
import {
  getVeryfrontCloudBootstrap,
  resolveVeryfrontPublicApiBaseUrlFromHostEnv,
} from "#veryfront/platform/cloud/resolver.ts";

/** Why the model gateway refused an eval's model requests. */
export type EvalModelAccessDenialKind =
  | "billing"
  | "spend-limit"
  | "project-required"
  | "unauthorized"
  | "forbidden"
  | "egress-blocked"
  | "inference-policy";

/** Refusal that every later eval record would hit the same way. */
export interface EvalModelAccessDenial {
  kind: EvalModelAccessDenialKind;
  code: string;
  message: string;
}

const DENIAL_ERRORS = {
  billing: EVAL_MODEL_ACCESS_DENIED,
  "spend-limit": EVAL_MODEL_SPEND_LIMIT_EXCEEDED,
  "project-required": EVAL_PROJECT_REQUIRED,
  unauthorized: EVAL_MODEL_UNAUTHORIZED,
  forbidden: EVAL_MODEL_PROJECT_ACCESS_DENIED,
  "egress-blocked": EVAL_MODEL_EGRESS_BLOCKED,
  "inference-policy": EVAL_MODEL_INFERENCE_POLICY_DENIED,
} as const;

const UNAUTHORIZED_DENIAL: EvalModelAccessDenial = {
  kind: "unauthorized",
  code: "UNAUTHORIZED",
  message: "Veryfront Cloud rejected the API credential (401 Unauthorized)",
};

const FORBIDDEN_DENIAL: EvalModelAccessDenial = {
  kind: "forbidden",
  code: "FORBIDDEN",
  message: "Veryfront Cloud denied the credential access to the linked project (403 Forbidden)",
};

function statusDenial(status: number): EvalModelAccessDenial | undefined {
  if (status === 401) return UNAUTHORIZED_DENIAL;
  if (status === 403) return FORBIDDEN_DENIAL;
  return undefined;
}

/**
 * Model gateway routes under a Veryfront API base URL: the vendor-neutral
 * OpenAI- and Anthropic-protocol routes, and the vendor-scoped route.
 */
const GATEWAY_ROUTE_PREFIXES: readonly string[] = ["/ai/v1/", "/ai/anthropic/", "/ai/gateway/"];

/**
 * Gateway provenance for a 401, 403, or project-required 400, whose bodies do
 * not prove where they came from: the failed request targeted a model gateway
 * route (`<api base>/ai/v1/`, `<api base>/ai/anthropic/` or
 * `<api base>/ai/gateway/`) under a configured Veryfront API base URL. A
 * direct or BYOK provider, even one behind a reverse proxy that shares the API
 * origin, uses a different route and stays a record failure.
 */
function isVeryfrontGatewayRoute(requestUrl: string | undefined): boolean {
  if (requestUrl === undefined) return false;
  const baseUrls = [
    getVeryfrontCloudBootstrap().apiBaseUrl,
    resolveVeryfrontPublicApiBaseUrlFromHostEnv(),
  ];
  for (const baseUrl of baseUrls) {
    if (baseUrl === undefined) continue;
    try {
      const base = new URL(baseUrl);
      const apiRoot = `${base.origin}${base.pathname.replace(/\/+$/, "")}`;
      for (const routePrefix of GATEWAY_ROUTE_PREFIXES) {
        if (requestUrl.startsWith(`${apiRoot}${routePrefix}`)) return true;
      }
    } catch {
      // An unparseable configured base URL matches nothing.
    }
  }
  return false;
}

const GATEWAY_PROJECT_REQUIRED_CODE = "gateway_project_required";
const GATEWAY_PROJECT_REQUIRED_MESSAGE =
  "A project is required to use Veryfront-managed AI inference";

const PROJECT_REQUIRED_DENIAL: EvalModelAccessDenial = {
  kind: "project-required",
  code: GATEWAY_PROJECT_REQUIRED_CODE,
  message: GATEWAY_PROJECT_REQUIRED_MESSAGE,
};

/**
 * Account-wide billing or entitlement denials. `RESOURCE_LIMIT_EXCEEDED` is
 * left out on purpose: it also covers per-request limits (output tokens,
 * concurrency, model-call counts) that a later record can stay within.
 */
const MODEL_ACCESS_DENIAL_CODES: ReadonlySet<string> = new Set([
  "INSUFFICIENT_CREDITS",
  "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
]);

/** Run-scoped credit cap: a later record starts a new run with its own budget. */
function isAgentRunCreditLimit(message: string): boolean {
  return message.toLowerCase().startsWith("agent run credit limit");
}

const MAX_ERROR_CHAIN_DEPTH = 8;

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function toDenial(failure: { code: string; message: string }): EvalModelAccessDenial | undefined {
  if (!MODEL_ACCESS_DENIAL_CODES.has(failure.code)) return undefined;
  if (isAgentRunCreditLimit(failure.message)) return undefined;
  // The platform spend limit clears with time or an administrator, not credits.
  const kind = failure.code === "AI_PROVIDER_SPEND_LIMIT_EXCEEDED" ? "spend-limit" : "billing";
  return { kind, code: failure.code, message: failure.message };
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * Gateway provenance comes from the Veryfront Cloud problem body the gateway
 * returns with a 402 (`slug: "insufficient-credits"`), which the provider
 * runtime keeps as the typed `responseBody`. A 402 from a direct or BYOK
 * provider carries no such body and stays a record failure, so it never gets
 * Veryfront billing advice. Message text is never consulted.
 */
/** Curated code the AG-UI stream carries for the gateway project-required refusal. */
const GATEWAY_PROJECT_REQUIRED_CURATED_CODE = "GATEWAY_PROJECT_REQUIRED";

/**
 * The gateway's project-required rejection, identified by its structured
 * `code` in the preserved response body. The detail always uses the gateway's
 * known wording rather than the response's `error` field: a custom provider
 * endpoint can return the same code with arbitrary text, which must not reach
 * user-facing output.
 */
function classifyProjectRequired(responseBody: string): EvalModelAccessDenial | undefined {
  const body = parseJsonBody(responseBody);
  if (readProperty(body, "code") !== GATEWAY_PROJECT_REQUIRED_CODE) return undefined;
  return PROJECT_REQUIRED_DENIAL;
}

const EGRESS_BLOCKED_DENIAL: EvalModelAccessDenial = {
  kind: "egress-blocked",
  code: "EGRESS_BLOCKED",
  message:
    "Veryfront blocked the request to the configured Veryfront API because its host resolves to a private network address",
};

/**
 * Classify the host egress guard's private-address block of a model gateway
 * request, with the same gateway provenance the HTTP refusals use: the gateway
 * fetch threw the block, or a model provider transport threw it for a request
 * on the gateway route of a configured Veryfront API. A tool, agent tool,
 * custom metric, local provider, another port on the API host, or a
 * non-gateway path stays a record failure.
 *
 * The guard must also have recorded the cause as a private-address block,
 * because proxy and broker connection failures reuse its wording. The denial
 * never names the host: a private or internal API hostname must not reach
 * user-facing CLI or JSON error output.
 */
function classifyOutboundRequestBlocked(
  error: OutboundRequestBlockedError,
): EvalModelAccessDenial | undefined {
  // The gateway fetch marks what it throws, which covers a gateway built with
  // an explicit per-model or run-scoped base URL; the configured route is the
  // fallback, matching how the HTTP refusals resolve provenance.
  const fromGateway = isVeryfrontGatewayTransportFailure(error) ||
    isVeryfrontGatewayRoute(getModelRequestTransportFailureUrl(error));
  if (!fromGateway) return undefined;
  if (!isPrivateAddressEgressBlock(readProperty(error, "cause"))) return undefined;
  return EGRESS_BLOCKED_DENIAL;
}

/** Curated codes for the gateway's EU-only inference policy refusals. */
const INFERENCE_POLICY_CODES: ReadonlySet<string> = new Set([
  "MODEL_NOT_PERMITTED",
  "INFERENCE_POLICY_DENIED",
]);

function toInferencePolicyDenial(
  failure: { code: string; message: string } | null | undefined,
): EvalModelAccessDenial | undefined {
  if (!failure || !INFERENCE_POLICY_CODES.has(failure.code)) return undefined;
  return { kind: "inference-policy", code: failure.code, message: failure.message };
}

function classifyProviderError(error: ProviderError): EvalModelAccessDenial | undefined {
  // The gateway fetch marks its own responses, which covers a gateway built
  // with an explicit per-model base URL; the configured route is the fallback.
  const fromGateway = error.viaVeryfrontGateway === true ||
    isVeryfrontGatewayRoute(error.requestUrl);
  // The provider runtime keeps an `eu_inference_policy` body only from the
  // gateway. The refusal (403, or 503 from older gateways) is not a credential
  // or project access denial.
  if (fromGateway && typeof error.responseBody === "string") {
    const policy = toInferencePolicyDenial(
      parseGatewayProblemBody(parseJsonBody(error.responseBody)),
    );
    if (policy) return policy;
  }
  if (error.status === 401 || error.status === 403) {
    return fromGateway ? statusDenial(error.status) : undefined;
  }
  if (typeof error.responseBody !== "string") return undefined;
  if (error.status === 400) {
    return fromGateway ? classifyProjectRequired(error.responseBody) : undefined;
  }
  if (error.status !== 402) return undefined;
  const parsed = parseKnownProblemBody(parseJsonBody(error.responseBody));
  return parsed ? toDenial(parsed) : undefined;
}

function findDenial(
  error: unknown,
  seen: Set<unknown>,
  depth: number,
): EvalModelAccessDenial | undefined {
  if (depth > MAX_ERROR_CHAIN_DEPTH || typeof error !== "object" || error === null) {
    return undefined;
  }
  if (seen.has(error)) return undefined;
  seen.add(error);

  if (error instanceof ProviderError) return classifyProviderError(error);
  if (error instanceof OutboundRequestBlockedError) {
    const blocked = classifyOutboundRequestBlocked(error);
    if (blocked) return blocked;
  }

  const registered = registeredProviderFailure(error);
  // Curated failures crossing a runtime boundary keep only the code, which does
  // not prove a Veryfront gateway source for billing codes. Only the
  // project-required code is gateway-specific.
  if (registered?.code === GATEWAY_PROJECT_REQUIRED_CURATED_CODE) return PROJECT_REQUIRED_DENIAL;
  // The EU inference policy codes are gateway-specific too; only the fixed
  // wording crosses the boundary.
  const policy = toInferencePolicyDenial(registered);
  if (policy) return policy;
  if (registered) return undefined;

  for (const key of ["lastError", "cause"]) {
    const nested = findDenial(readProperty(error, key), seen, depth + 1);
    if (nested) return nested;
  }
  const errors = readProperty(error, "errors");
  if (Array.isArray(errors)) {
    for (const nestedError of errors.slice(0, MAX_ERROR_CHAIN_DEPTH)) {
      const nested = findDenial(nestedError, seen, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Recognize a model request the gateway refused for billing or entitlement
 * reasons. Only typed provider errors and curated provider failures count:
 * free-form error text from project code never classifies as a denial.
 */
export function classifyEvalModelAccessDenial(error: unknown): EvalModelAccessDenial | undefined {
  try {
    return findDenial(error, new Set(), 0);
  } catch {
    return undefined;
  }
}

/**
 * Recognize a denial in a failed agent service response body: an HTTP 400 or
 * 402 gateway body, or a curated code on the AG-UI run error. The agent service
 * is the endpoint the adapter was configured with, which is the provenance.
 * HTTP 401 and 403 are not classified: an application hook can return either for
 * one example, so they stay ordinary failures of that example.
 */
export function classifyAgentServiceModelAccessDenial(input: {
  status: number;
  body: string | null;
  runErrorCode?: unknown;
  runErrorMessage?: unknown;
}): EvalModelAccessDenial | undefined {
  try {
    if (input.status === 400 && input.body) {
      // The endpoint's own text is not trusted for user-facing output.
      const projectRequired = classifyProjectRequired(input.body);
      if (projectRequired) return projectRequired;
    }
    if (input.status === 402 && input.body) {
      const parsed = parseKnownProblemBody(parseJsonBody(input.body));
      if (parsed) return toDenial(parsed);
    }
    if (input.runErrorCode === GATEWAY_PROJECT_REQUIRED_CURATED_CODE) {
      // Streaming agent services report the gateway refusal as a RUN_ERROR.
      return PROJECT_REQUIRED_DENIAL;
    }
    if (typeof input.runErrorCode === "string" && INFERENCE_POLICY_CODES.has(input.runErrorCode)) {
      // Fixed local wording; the endpoint's RUN_ERROR text is not trusted.
      return toInferencePolicyDenial(
        curatedProviderFailure(input.runErrorCode as CuratedProviderFailureCode),
      );
    }
    // A curated billing code on RUN_ERROR (INSUFFICIENT_CREDITS, spend limit)
    // is not classified: the stream can derive it from any provider's failure,
    // including a direct or BYOK provider, so it carries no gateway provenance.
  } catch {
    return undefined;
  }
  return undefined;
}

/** Build the fail-fast error for an eval whose model requests are refused. */
export function createEvalModelAccessDeniedError(
  evalId: string,
  denial: EvalModelAccessDenial,
  cause: unknown,
): VeryfrontError {
  const definition = denial.kind === "inference-policy" && denial.code === "INFERENCE_POLICY_DENIED"
    ? EVAL_INFERENCE_POLICY_DENIED
    : DENIAL_ERRORS[denial.kind];
  return definition.create({
    detail: `Eval "${evalId}" stopped at its first refused model request: ${denial.message}`,
    context: { evalId, denialCode: denial.code },
    cause,
  });
}

/** Return the denial kind when an error is one of the eval fail-fast errors. */
export function getEvalModelAccessDenialKind(
  error: unknown,
): EvalModelAccessDenialKind | undefined {
  try {
    if (!(error instanceof VeryfrontError)) return undefined;
    if (error.slug === EVAL_INFERENCE_POLICY_DENIED.slug) return "inference-policy";
    for (const [kind, definition] of Object.entries(DENIAL_ERRORS)) {
      if (error.slug === definition.slug) return kind as EvalModelAccessDenialKind;
    }
  } catch {
    // Hostile thrown values (revoked proxies) are never the fail-fast error.
  }
  return undefined;
}

/** Return true when an error is one of the eval fail-fast model access errors. */
/**
 * The gateway answers `gateway_project_required` both when no project was sent
 * and when the sent slug names no project the credential can use. When the
 * caller knows it sent one, say that the configured project was rejected
 * instead of implying none was set.
 *
 * The slug stays out of the message: it is an account identifier that would
 * land in terminal and CI logs. So does its origin, because the caller passes
 * only the resolved value, and it can come from the environment, the module
 * config, `veryfront.json` or `.veryfront/project.json`. The error's own
 * suggestion lists the places to correct. The wording covers "missing" and
 * "not accessible" alike, as the gateway does.
 */
export function explainConfiguredProjectDenial(
  error: unknown,
  projectSlug: string | undefined,
): unknown {
  if (!projectSlug?.trim() || getEvalModelAccessDenialKind(error) !== "project-required") {
    return error;
  }
  const evalId = readProperty(readProperty(error, "context"), "evalId");
  if (typeof evalId !== "string") return error;
  return createEvalModelAccessDeniedError(evalId, {
    kind: "project-required",
    code: GATEWAY_PROJECT_REQUIRED_CODE,
    message:
      "Veryfront Cloud rejected the project this run is configured with: it does not exist or this " +
      "credential has no access to it",
  }, error);
}

export function isEvalModelAccessDeniedError(error: unknown): error is VeryfrontError {
  return getEvalModelAccessDenialKind(error) !== undefined;
}
