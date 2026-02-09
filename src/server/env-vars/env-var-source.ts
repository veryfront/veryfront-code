/**
 * Environment Variable Source Interface & API Implementation
 *
 * Defines the contract for fetching environment variables and provides
 * an implementation that fetches from the Veryfront REST API.
 *
 * @module server/env-vars/env-var-source
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import { injectContext } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = getBaseLogger("ENV-VARS");

/**
 * Interface for fetching environment variables by environment ID.
 */
export interface EnvVarSource {
  fetchByEnvironmentId(environmentId: string): Promise<Record<string, string>>;
}

interface EnvironmentVariable {
  id: string;
  name: string;
  value: string;
}

interface EnvironmentResponse {
  id: string;
  name: string;
  environment_variables: EnvironmentVariable[];
}

/**
 * Fetches environment variables from the Veryfront REST API.
 *
 * Uses the endpoint: GET /projects/{projectSlug}/environments/{environmentId}
 */
export class ApiEnvVarSource implements EnvVarSource {
  private readonly timeoutMs: number;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly apiToken: string,
    options?: { timeoutMs?: number },
  ) {
    this.timeoutMs = options?.timeoutMs ?? 10_000;
  }

  async fetchByEnvironmentId(environmentId: string): Promise<Record<string, string>> {
    const url = `${this.apiBaseUrl}/environments/${encodeURIComponent(environmentId)}/variables`;

    logger.debug("[EnvVarSource] Fetching env vars", { environmentId });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = new Headers({
        Authorization: `Bearer ${this.apiToken}`,
        Accept: "application/json",
      });
      injectContext(headers);

      const response = await fetch(url, { headers, signal: controller.signal });

      if (!response.ok) {
        logger.error("[EnvVarSource] API error", {
          environmentId,
          status: response.status,
        });
        throw new Error(`Failed to fetch env vars: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as EnvironmentResponse;
      const vars: Record<string, string> = {};

      for (const envVar of data.environment_variables ?? []) {
        vars[envVar.name] = envVar.value;
      }

      logger.debug("[EnvVarSource] Fetched env vars", {
        environmentId,
        count: Object.keys(vars).length,
      });

      return vars;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
