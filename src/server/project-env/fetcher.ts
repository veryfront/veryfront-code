/**
 * Fetches project environment variables from the Veryfront API.
 *
 * @module server/project-env/fetcher
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";

const baseLogger = getBaseLogger("PROJECT-ENV");

const logger = baseLogger.component("project-env");

/** Max env vars per request. API enforces a hard cap of 100. */
const ENV_VARS_FETCH_LIMIT = 100;

/**
 * Fetch environment variables for a project from the Veryfront API.
 *
 * Calls: GET {apiBaseUrl}/projects/{projectSlug}/env-vars?environment_id={environmentId}&limit=100
 * Response: { data: [{ key: string, value: string }] }
 */
export async function fetchProjectEnvVars(
  apiBaseUrl: string,
  projectSlug: string,
  environmentId: string,
  token: string,
): Promise<Record<string, string>> {
  const url = `${apiBaseUrl}/projects/${encodeURIComponent(projectSlug)}/env-vars?environment_id=${
    encodeURIComponent(environmentId)
  }&limit=${ENV_VARS_FETCH_LIMIT}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      await response.body?.cancel();
      logger.warn("Failed to fetch env vars", {
        projectSlug,
        environmentId,
        status: response.status,
      });
      throw new Error(`Failed to fetch env vars: ${response.status}`);
    }

    const body = await response.json() as {
      data?: Array<{ key: string; value: string }>;
    };

    const result: Record<string, string> = {};
    if (body.data) {
      for (const entry of body.data) {
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
    if (error instanceof Error && error.message.startsWith("Failed to fetch env vars")) {
      throw error;
    }
    logger.error("Env var fetch error", {
      projectSlug,
      environmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
