import { readEnvironmentVariable } from "./environment.ts";
import {
  fetchOAuthJsonWithScopePolicy,
  type OAuthScopePolicy,
} from "./oauth.ts";

type AtlassianService = "confluence" | "jira";

type AccessibleResource = {
  id: string;
  scopes: string[];
};

const ACCESSIBLE_RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";
const MAX_ACCESSIBLE_RESOURCES = 100;
const MAX_CLOUD_ID_LENGTH = 128;
const MAX_SCOPE_LENGTH = 256;

function normalizeAccessibleResources(value: unknown): AccessibleResource[] {
  if (!Array.isArray(value) || value.length > MAX_ACCESSIBLE_RESOURCES) {
    throw new Error(
      "Atlassian returned an invalid accessible-resources response",
    );
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Atlassian returned an invalid accessible resource");
    }
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(candidate.id) ||
      candidate.id.length > MAX_CLOUD_ID_LENGTH ||
      !Array.isArray(candidate.scopes) ||
      candidate.scopes.some((scope) =>
        typeof scope !== "string" || scope.length === 0 ||
        scope.length > MAX_SCOPE_LENGTH
      )
    ) {
      throw new Error("Atlassian returned malformed accessible-resource data");
    }

    return { id: candidate.id, scopes: [...candidate.scopes] as string[] };
  });
}

function supportsService(
  resource: AccessibleResource,
  service: AtlassianService,
): boolean {
  return resource.scopes.some((scope) =>
    service === "jira"
      ? scope.includes(":jira-")
      : scope.includes(":confluence")
  );
}

/**
 * Resolve one user-accessible Atlassian site without silently selecting among
 * multiple tenants. Operators can select a site explicitly with
 * `JIRA_CLOUD_ID` or `CONFLUENCE_CLOUD_ID`; the configured ID is still checked
 * against the authenticated user's accessible resources.
 */
export async function resolveAtlassianCloudId(
  userId: string,
  service: AtlassianService,
  scopePolicy: OAuthScopePolicy,
): Promise<string> {
  const rawResources = await fetchOAuthJsonWithScopePolicy<unknown>(
    userId,
    service,
    ACCESSIBLE_RESOURCES_URL,
    scopePolicy,
  );
  const resources = normalizeAccessibleResources(rawResources).filter((
    resource,
  ) => supportsService(resource, service));
  const variableName = service === "jira"
    ? "JIRA_CLOUD_ID"
    : "CONFLUENCE_CLOUD_ID";
  const configuredId = readEnvironmentVariable(variableName)?.trim();

  if (configuredId) {
    if (!resources.some((resource) => resource.id === configuredId)) {
      throw new Error(
        `${variableName} is not accessible to the authenticated Atlassian user`,
      );
    }
    return configuredId;
  }

  if (resources.length === 1) return resources[0]!.id;
  if (resources.length === 0) {
    throw new Error(
      `No ${service} site is accessible to the authenticated Atlassian user`,
    );
  }
  throw new Error(
    `Multiple ${service} sites are accessible; configure ${variableName} explicitly`,
  );
}
