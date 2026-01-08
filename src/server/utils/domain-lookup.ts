/**
 * Domain Lookup Service
 *
 * Resolves custom domains to project slugs and environments.
 * Used for JIT rendering of production sites with custom domains.
 */

import { logger } from "@veryfront/utils";

export interface DomainLookupResult {
  projectId: string;
  projectSlug: string;
  projectName: string;
  environment: { id: string; name: string } | null;
  releaseId: string | null;
}

export interface DomainLookupConfig {
  apiBaseUrl: string;
  apiToken: string;
}

/**
 * Look up project info by custom domain.
 * Calls the Veryfront API to resolve domain → project mapping.
 */
export async function lookupProjectByDomain(
  domain: string,
  config: DomainLookupConfig,
): Promise<DomainLookupResult | null> {
  // Strip port from domain if present
  const domainWithoutPort = domain.replace(/:\d+$/, "");
  const encodedDomain = encodeURIComponent(domainWithoutPort);
  const url = `${config.apiBaseUrl}/lookup/domain/${encodedDomain}`;

  logger.debug("[DomainLookup] Looking up project by domain", { domain, url });

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      logger.debug("[DomainLookup] No project found for domain", { domain });
      return null;
    }

    if (!response.ok) {
      logger.error("[DomainLookup] API error", {
        domain,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const result = await response.json() as DomainLookupResult;

    logger.info("[DomainLookup] Domain lookup result", {
      domain,
      projectSlug: result.projectSlug,
      projectId: result.projectId,
      environment: result.environment?.name,
      releaseId: result.releaseId ?? "null",
    });

    return result;
  } catch (error) {
    logger.error("[DomainLookup] Failed to lookup domain", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Determine the environment type from the lookup result.
 */
export function getEnvironmentType(
  result: DomainLookupResult | null,
): "preview" | "production" | undefined {
  if (!result?.environment) {
    return undefined;
  }

  const envName = result.environment.name.toLowerCase();

  // Production environments typically contain "production" or "prod"
  if (envName.includes("production") || envName === "prod") {
    return "production";
  }

  // Preview/staging environments
  if (
    envName.includes("preview") || envName.includes("staging") || envName.includes("development")
  ) {
    return "preview";
  }

  // Default to production for custom domains (most common use case)
  return "production";
}
