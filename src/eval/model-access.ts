import {
  EVAL_AGENT_SERVICE_ACCESS_DENIED,
  EVAL_AGENT_SERVICE_UNAUTHORIZED,
  EVAL_MODEL_ACCESS_DENIED,
  EVAL_MODEL_PROJECT_ACCESS_DENIED,
  EVAL_MODEL_SPEND_LIMIT_EXCEEDED,
  EVAL_MODEL_UNAUTHORIZED,
  EVAL_PROJECT_REQUIRED,
  VeryfrontError,
} from "#veryfront/errors";
import { parseKnownProblemBody } from "#veryfront/chat/provider-errors.ts";
import { registeredProviderFailure } from "#veryfront/chat/provider-error-registry.ts";
import { ProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";
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
  | "agent-service-unauthorized"
  | "agent-service-forbidden";

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
  "agent-service-unauthorized": EVAL_AGENT_SERVICE_UNAUTHORIZED,
  "agent-service-forbidden": EVAL_AGENT_SERVICE_ACCESS_DENIED,
} as const;

/**
 * Classify an agent service 401 or 403 from its status alone, before the body
 * is read. It concerns the adapter's own token and project, not the model
 * gateway credential, so it gets agent-service guidance. A 401 always stops
 * the eval: the token is the same for every example. A 403 stops it only when
 * the adapter fixes the project for the whole eval; otherwise any example can
 * choose another project, so one inaccessible project fails only that example.
 */
export function classifyAgentServiceAccessStatus(
  status: number,
  options: { projectScopeFixed: boolean },
): EvalModelAccessDenial | undefined {
  if (status === 401) {
    return {
      kind: "agent-service-unauthorized",
      code: "UNAUTHORIZED",
      message: "The agent service rejected the eval request credential (401 Unauthorized)",
    };
  }
  if (status === 403 && options.projectScopeFixed) {
    return {
      kind: "agent-service-forbidden",
      code: "FORBIDDEN",
      message: "The agent service denied the eval request access (403 Forbidden)",
    };
  }
  return undefined;
}

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
 * Gateway provenance for a 401, 403, or project-required 400, whose bodies do
 * not prove where they came from: the failed request targeted the model
 * gateway route (`<api base>/ai/gateway/`) under a configured Veryfront API
 * base URL. A direct or BYOK provider, even one behind a reverse proxy that
 * shares the API origin, uses a different route and stays a record failure.
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
      const gatewayPrefix = `${base.origin}${base.pathname.replace(/\/+$/, "")}/ai/gateway/`;
      if (requestUrl.startsWith(gatewayPrefix)) return true;
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

function classifyProviderError(error: ProviderError): EvalModelAccessDenial | undefined {
  // The gateway fetch marks its own responses, which covers a gateway built
  // with an explicit per-model base URL; the configured route is the fallback.
  const fromGateway = error.viaVeryfrontGateway === true ||
    isVeryfrontGatewayRoute(error.requestUrl);
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

  const registered = registeredProviderFailure(error);
  // Curated failures crossing a runtime boundary keep only the code, which does
  // not prove a Veryfront gateway source for billing codes. Only the
  // project-required code is gateway-specific.
  if (registered?.code === GATEWAY_PROJECT_REQUIRED_CURATED_CODE) return PROJECT_REQUIRED_DENIAL;
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
 * HTTP 401 and 403 are classified earlier by `classifyAgentServiceAccessStatus`.
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
  return DENIAL_ERRORS[denial.kind].create({
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
    for (const [kind, definition] of Object.entries(DENIAL_ERRORS)) {
      if (error.slug === definition.slug) return kind as EvalModelAccessDenialKind;
    }
  } catch {
    // Hostile thrown values (revoked proxies) are never the fail-fast error.
  }
  return undefined;
}

/** Return true when an error is one of the eval fail-fast model access errors. */
export function isEvalModelAccessDeniedError(error: unknown): error is VeryfrontError {
  return getEvalModelAccessDenialKind(error) !== undefined;
}
