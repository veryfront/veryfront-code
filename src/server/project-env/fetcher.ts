/**
 * Fetches project environment variables from the Veryfront API.
 *
 * @module server/project-env/fetcher
 */

import { encodeBase64, getBaseLogger } from "#veryfront/utils";
import { AUTHENTICATION_REQUIRED, NETWORK_ERROR, PERMISSION_DENIED } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const baseLogger = getBaseLogger("PROJECT-ENV");

const logger = baseLogger.component("project-env");

/** Max env vars per request. API enforces a hard cap of 100. */
const ENV_VARS_FETCH_LIMIT = 100;
const MASKED_ENV_VALUE = "********";

type EnvironmentVariableResponse = {
  data?: Array<{ key: string; value: string }>;
};

function getInternalAuthorization(): string | undefined {
  const username = getHostEnv("VERYFRONT_API_INTERNAL_USER");
  const password = getHostEnv("VERYFRONT_API_INTERNAL_PASS");
  if (!username || !password) return undefined;
  return `Basic ${encodeBase64(`${username}:${password}`)}`;
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
    return await fetch(url, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        ...headers,
      },
      redirect: "error",
      signal,
    });
  } catch (error) {
    logger.error("Env var fetch network error", {
      projectSlug,
      environmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
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
    await response.body?.cancel();
    logger.warn("Project credential cannot access requested environment", {
      projectSlug,
      environmentId,
      status: response.status,
    });
    throw projectAuthorizationError(response.status);
  }

  // Do not even materialize the host credential until the tenant credential
  // has proved access to this canonical project/environment pair.
  const internalAuthorization = getInternalAuthorization();
  if (internalAuthorization) {
    await response.body?.cancel();
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
    await response.body?.cancel();
    logger.warn("Failed to fetch env vars", {
      projectSlug,
      environmentId,
      status: response.status,
    });
    throw NETWORK_ERROR.create({ detail: "Internal project environment request failed" });
  }

  try {
    const body = await response.json() as EnvironmentVariableResponse;

    const result: Record<string, string> = {};
    if (body.data) {
      for (const entry of body.data) {
        if (entry.value === MASKED_ENV_VALUE) {
          throw NETWORK_ERROR.create({
            detail: "Refusing masked environment variable response",
          });
        }
        result[entry.key] = entry.value;
      }
    }

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
