/**
 * Fetches project environment variables from the Veryfront API.
 *
 * @module server/project-env/fetcher
 */

import { getBaseLogger } from "#veryfront/utils";
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
  return `Basic ${globalThis.btoa(`${username}:${password}`)}`;
}

async function fetchEnvironmentVariables(
  url: string,
  authorization: string,
  projectSlug: string,
  environmentId: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
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
 * Hosted runtimes call the internal Basic-auth endpoint first. Older API deployments
 * without that endpoint fall back to the bearer-auth management endpoint.
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
  }`;

  const internalAuthorization = getInternalAuthorization();
  let response = internalAuthorization
    ? await fetchEnvironmentVariables(
      internalUrl,
      internalAuthorization,
      projectSlug,
      environmentId,
    )
    : await fetchEnvironmentVariables(
      managementUrl,
      `Bearer ${token}`,
      projectSlug,
      environmentId,
    );

  if (internalAuthorization && response.status === 404) {
    await response.body?.cancel();
    response = await fetchEnvironmentVariables(
      managementUrl,
      `Bearer ${token}`,
      projectSlug,
      environmentId,
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
