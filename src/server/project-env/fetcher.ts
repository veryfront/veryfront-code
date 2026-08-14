/**
 * Fetches project environment variables from the Veryfront API.
 *
 * @module server/project-env/fetcher
 */

import { getBaseLogger } from "#veryfront/utils";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import {
  AUTHENTICATION_REQUIRED,
  CONFIG_INVALID,
  isVeryfrontError,
  NETWORK_ERROR,
  PERMISSION_DENIED,
} from "#veryfront/errors";
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import { createProjectEnvSnapshot } from "./snapshot.ts";
import {
  getMissingProjectEnvInternalCredentialDetail,
  getProjectEnvInternalAuthorization,
  requiresProjectEnvInternalAuthorization,
} from "./internal-authorization.ts";

const baseLogger = getBaseLogger("PROJECT-ENV");

const logger = baseLogger.component("project-env");

/** Max env vars per request. API enforces a hard cap of 100. */
const ENV_VARS_FETCH_LIMIT = 100;
const MASKED_ENV_VALUE = "********";
/** Hard ceiling for the complete JSON envelope returned by the env API. */
export const PROJECT_ENV_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();

function discardResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Best-effort cleanup; admission has already failed closed.
  }
}

function parseDeclaredContentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function invalidEnvironmentResponse(detail: string, cause?: unknown): Error {
  return NETWORK_ERROR.create({ detail, cause });
}

async function readBoundedEnvironmentResponse(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  const declaredLength = parseDeclaredContentLength(response);
  if (declaredLength !== undefined && declaredLength > PROJECT_ENV_RESPONSE_MAX_BYTES) {
    discardResponseBody(response);
    throw invalidEnvironmentResponse("Project environment response exceeded its size limit");
  }

  const { text, truncated } = await readResponseTextPrefix(
    response,
    PROJECT_ENV_RESPONSE_MAX_BYTES + 1,
    signal,
    { fatalUtf8: true },
  );
  if (
    truncated || UTF8_ENCODER.encode(text).byteLength > PROJECT_ENV_RESPONSE_MAX_BYTES
  ) {
    throw invalidEnvironmentResponse("Project environment response exceeded its size limit");
  }
  return text;
}

/** Which endpoint produced the parsed body; masked values mean different things per source. */
type EnvironmentResponseSource = "management" | "internal";

function maskedEnvironmentError(source: EnvironmentResponseSource): Error {
  if (source === "management") {
    // The management endpoint masks every value by contract. Reaching a masked
    // value here means the host has no internal credentials configured, so the
    // refusal must state the operator-actionable cause.
    return invalidEnvironmentResponse(
      "Refusing masked environment variable response: the management endpoint masks values by contract " +
        "and VERYFRONT_API_INTERNAL_USER/VERYFRONT_API_INTERNAL_PASS are not configured on this host",
    );
  }
  return invalidEnvironmentResponse(
    "Refusing masked environment variable response: the internal endpoint returned a masked value",
  );
}

function parseEnvironmentResponse(
  text: string,
  source: EnvironmentResponseSource,
): Readonly<Record<string, string>> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw invalidEnvironmentResponse("Project environment response was not valid JSON", cause);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidEnvironmentResponse("Project environment response must be an object");
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw invalidEnvironmentResponse("Project environment response must contain a data array");
  }
  if (data.length > ENV_VARS_FETCH_LIMIT) {
    throw invalidEnvironmentResponse("Project environment response contained too many entries");
  }

  const result = Object.create(null) as Record<string, string>;
  const keys = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw invalidEnvironmentResponse("Project environment response contained an invalid entry");
    }
    const key = (entry as { key?: unknown }).key;
    const value = (entry as { value?: unknown }).value;
    if (typeof key !== "string" || typeof value !== "string") {
      throw invalidEnvironmentResponse(
        "Project environment response entries must contain string keys and values",
      );
    }
    if (keys.has(key)) {
      throw invalidEnvironmentResponse("Project environment response contained a duplicate key");
    }
    keys.add(key);
    if (value === MASKED_ENV_VALUE) {
      throw maskedEnvironmentError(source);
    }
    result[key] = value;
  }

  try {
    return createProjectEnvSnapshot(result);
  } catch (cause) {
    throw invalidEnvironmentResponse("Project environment response violated runtime limits", cause);
  }
}

async function fetchEnvironmentVariables(
  url: string,
  authorization: string,
  projectSlug: string,
  environmentId: string,
  signal?: AbortSignal,
  headers: HeadersInit = {},
): Promise<Response> {
  try {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Authorization", authorization);
    requestHeaders.set("Accept", "application/json");
    return await fetch(url, {
      headers: requestHeaders,
      redirect: "error",
      signal,
    });
  } catch (error) {
    logger.error("Env var fetch network error", {
      projectSlug,
      environmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (signal?.aborted) {
      throw isErrorAcrossRealms(signal.reason)
        ? signal.reason
        : new DOMException("Project environment request was cancelled", "AbortError");
    }
    if (isVeryfrontError(error)) throw error;
    throw NETWORK_ERROR.create({
      detail: "Project environment request failed",
      cause: error,
    });
  }
}

function projectAuthorizationError(status: number): Error {
  if (status === 401) {
    return AUTHENTICATION_REQUIRED.create({
      detail: "Project credential was rejected",
    });
  }
  if (status === 403 || status === 404) {
    return PERMISSION_DENIED.create({
      detail: "Project credential is not authorized for the requested environment",
    });
  }
  return NETWORK_ERROR.create({
    detail: "Project environment authorization request failed",
  });
}

/**
 * Fetch environment variables for a project from the Veryfront API.
 *
 * The caller's project credential is always checked against the project-scoped
 * management endpoint before host-level internal credentials may retrieve secret
 * values. This prevents a tenant-controlled environment ID from turning the
 * runtime's internal credentials into a cross-project confused deputy.
 *
 * Deployments that configure internal credentials must expose the internal
 * endpoint. There is intentionally no fallback after that privileged path fails.
 * Response: { data: [{ key: string, value: string }] }
 */
export async function fetchProjectEnvVars(
  apiBaseUrl: string,
  projectSlug: string,
  environmentId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const managementUrl = `${apiBaseUrl}/projects/${
    encodeURIComponent(projectSlug)
  }/environment-variables?environment_id=${
    encodeURIComponent(environmentId)
  }&limit=${ENV_VARS_FETCH_LIMIT}`;
  const internalUrl = `${apiBaseUrl}/internal/project-environment-variables?environment_id=${
    encodeURIComponent(environmentId)
  }&project_slug=${encodeURIComponent(projectSlug)}`;

  let response = await fetchEnvironmentVariables(
    managementUrl,
    `Bearer ${token}`,
    projectSlug,
    environmentId,
    signal,
  );

  if (!response.ok) {
    discardResponseBody(response);
    logger.warn("Project credential cannot access requested environment", {
      projectSlug,
      environmentId,
      status: response.status,
    });
    throw projectAuthorizationError(response.status);
  }

  // Do not even materialize the host credential until the tenant credential
  // has proved access to this canonical project/environment pair.
  const internalAuthorization = getProjectEnvInternalAuthorization();
  if (!internalAuthorization && requiresProjectEnvInternalAuthorization()) {
    discardResponseBody(response);
    throw CONFIG_INVALID.create({
      detail: getMissingProjectEnvInternalCredentialDetail() ??
        "Internal project environment authorization is unavailable in hosted proxy mode",
    });
  }
  if (internalAuthorization) {
    discardResponseBody(response);
    response = await fetchEnvironmentVariables(
      internalUrl,
      internalAuthorization,
      projectSlug,
      environmentId,
      signal,
      { "x-project-slug": projectSlug },
    );
  }

  if (!response.ok) {
    discardResponseBody(response);
    logger.warn("Failed to fetch env vars", {
      projectSlug,
      environmentId,
      status: response.status,
    });
    throw NETWORK_ERROR.create({ detail: "Internal project environment request failed" });
  }

  try {
    const result = parseEnvironmentResponse(
      await readBoundedEnvironmentResponse(response, signal),
      internalAuthorization ? "internal" : "management",
    );

    logger.debug("Fetched env vars", {
      projectSlug,
      environmentId,
      count: Object.keys(result).length,
    });

    return result;
  } catch (error) {
    logger.error("Env var fetch parse error", {
      projectSlug,
      environmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Test-only access to the privileged fetch helper. Never import this outside
 * `fetcher.test.ts`.
 *
 * The header-authority regression it guards (authoritative `Authorization`/
 * `Accept` must be set after merging optional caller headers) is unobservable
 * through `fetchProjectEnvVars`: the public path only ever passes a benign
 * `x-project-slug` header, so a reintroduced spread-order bug would not change
 * the public function's behavior in a test.
 *
 * @internal
 */
export const projectEnvFetcherInternals = {
  fetchEnvironmentVariables,
} as const;
