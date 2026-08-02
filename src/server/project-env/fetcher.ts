/**
 * Fetches project environment variables from the Veryfront API.
 *
 * @module server/project-env/fetcher
 */

import { encodeBase64, getBaseLogger } from "#veryfront/utils";
import { NETWORK_ERROR } from "#veryfront/errors";
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
  headers: HeadersInit = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        ...headers,
      },
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
): Promise<Record<string, string>> {
  const managementUrl = `${apiBaseUrl}/projects/${
    encodeURIComponent(projectSlug)
  }/environment-variables?environment_id=${
    encodeURIComponent(environmentId)
  }&limit=${ENV_VARS_FETCH_LIMIT}`;
  const internalUrl = `${apiBaseUrl}/internal/project-environment-variables?environment_id=${
    encodeURIComponent(environmentId)
  }&project_slug=${encodeURIComponent(projectSlug)}`;

  const internalAuthorization = getInternalAuthorization();
  let response = await fetchEnvironmentVariables(
    managementUrl,
    `Bearer ${token}`,
    projectSlug,
    environmentId,
  );

  if (!response.ok) {
    await response.body?.cancel();
    logger.warn("Project credential cannot access requested environment", {
      projectSlug,
      environmentId,
      status: response.status,
    });
    throw NETWORK_ERROR.create({
      detail: `Project credential cannot access requested environment: ${response.status}`,
    });
  }

  if (internalAuthorization) {
    await response.body?.cancel();
    response = await fetchEnvironmentVariables(
      internalUrl,
      internalAuthorization,
      projectSlug,
      environmentId,
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
    throw NETWORK_ERROR.create({ detail: `Failed to fetch env vars: ${response.status}` });
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
