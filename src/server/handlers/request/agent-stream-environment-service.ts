import type { RuntimeAgentTargetSelectionInput } from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import { resolveVeryfrontApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import { serverLogger } from "#veryfront/utils";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import {
  EnvironmentVariableCache,
  fetchProjectEnvVars,
  filterRuntimeProjectEnv,
} from "../../project-env/index.ts";

const logger = serverLogger.component("agent-stream-environment");
const ENVIRONMENT_REQUEST_TIMEOUT_MS = 10_000;
const ENVIRONMENT_CACHE_TTL_MS = 5 * 60 * 1_000;
const EMPTY_ENVIRONMENT_CACHE_TTL_MS = 30 * 1_000;
const MAX_ENVIRONMENT_RESPONSE_BYTES = 256 * 1_024;
const MAX_ENVIRONMENTS = 1_000;

interface EnvironmentListItem {
  readonly id: string;
  readonly name?: string;
}

type EnvironmentResolution =
  | { readonly status: "resolved"; readonly environmentId: string }
  | { readonly status: "missing" }
  | { readonly status: "ambiguous" }
  | { readonly status: "unavailable" };

export class AgentStreamEnvironmentSelectionError extends Error {
  constructor(readonly status: 409 | 503, message: string) {
    super(message);
    this.name = "AgentStreamEnvironmentSelectionError";
  }
}

const environmentVariables = new EnvironmentVariableCache(
  (environmentId, token, projectSlug) =>
    fetchProjectEnvVars(
      resolveVeryfrontApiBaseUrlFromHostEnv(),
      projectSlug,
      environmentId,
      token,
    ),
);
const productionEnvironmentIds = new LRUCacheAdapter({ maxEntries: 1_000 });

function parseEnvironmentList(text: string): EnvironmentListItem[] {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || !("data" in value)) {
    throw new TypeError("Invalid environment list response");
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length > MAX_ENVIRONMENTS) {
    throw new TypeError("Invalid environment list response");
  }
  return data.map((entry): EnvironmentListItem => {
    if (
      typeof entry !== "object" || entry === null || Array.isArray(entry) ||
      typeof (entry as { id?: unknown }).id !== "string" ||
      (entry as { id: string }).id.length === 0 ||
      (entry as { id: string }).id.length > 512
    ) {
      throw new TypeError("Invalid environment list response");
    }
    const name = (entry as { name?: unknown }).name;
    if (name !== undefined && (typeof name !== "string" || name.length > 128)) {
      throw new TypeError("Invalid environment list response");
    }
    return name === undefined
      ? { id: (entry as { id: string }).id }
      : { id: (entry as { id: string }).id, name };
  });
}

async function resolveProductionEnvironmentId(
  projectSlug: string,
  token: string,
): Promise<EnvironmentResolution> {
  const apiBaseUrl = resolveVeryfrontApiBaseUrlFromHostEnv();
  const cacheKey = JSON.stringify([apiBaseUrl, projectSlug]);
  const cached = productionEnvironmentIds.get<EnvironmentResolution>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(
      `${apiBaseUrl}/projects/${encodeURIComponent(projectSlug)}/environments`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(ENVIRONMENT_REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return { status: "unavailable" };
    }
    const { text, truncated } = await readResponseTextPrefix(
      response,
      MAX_ENVIRONMENT_RESPONSE_BYTES + 1,
    );
    if (
      truncated || new TextEncoder().encode(text).byteLength > MAX_ENVIRONMENT_RESPONSE_BYTES
    ) {
      throw new TypeError("Environment list response is too large");
    }
    const production = parseEnvironmentList(text).filter((entry) => entry.name === "production");
    const resolution: EnvironmentResolution = production.length === 1
      ? { status: "resolved", environmentId: production[0]!.id }
      : { status: production.length === 0 ? "missing" : "ambiguous" };
    productionEnvironmentIds.set(
      cacheKey,
      resolution,
      resolution.status === "resolved" ? ENVIRONMENT_CACHE_TTL_MS : EMPTY_ENVIRONMENT_CACHE_TTL_MS,
    );
    return resolution;
  } catch {
    logger.warn("Unable to resolve production environment for agent stream", {
      failureCategory: "request-error",
    });
    return { status: "unavailable" };
  }
}

async function selectEnvironmentId(input: {
  projectSlug: string;
  token: string;
  contextEnvironmentId?: string;
  runtimeTarget: RuntimeAgentTargetSelectionInput;
}): Promise<string | null> {
  const contextEnvironmentId = input.contextEnvironmentId || null;
  const kind = input.runtimeTarget.runtimeTargetKind ?? "main_branch";
  if (kind === "environment") {
    const signedId = input.runtimeTarget.runtimeTargetEnvironmentId;
    if (!signedId || (contextEnvironmentId !== null && contextEnvironmentId !== signedId)) {
      throw new AgentStreamEnvironmentSelectionError(
        409,
        "Agent stream environment selection conflicts with the signed target",
      );
    }
    return signedId;
  }
  if (kind === "preview_branch") {
    if (contextEnvironmentId !== null) {
      throw new AgentStreamEnvironmentSelectionError(
        409,
        "Agent stream environment selection conflicts with the signed target",
      );
    }
    return null;
  }

  const production = await resolveProductionEnvironmentId(input.projectSlug, input.token);
  if (production.status !== "resolved") {
    throw new AgentStreamEnvironmentSelectionError(
      503,
      "A unique production environment is required for this agent stream",
    );
  }
  if (
    contextEnvironmentId !== null && contextEnvironmentId !== production.environmentId
  ) {
    throw new AgentStreamEnvironmentSelectionError(
      409,
      "Agent stream environment selection conflicts with the signed target",
    );
  }
  return production.environmentId;
}

/** Resolve only the exact environment selected by signed run metadata. */
export async function buildAgentRunProjectEnvironment(input: {
  projectSlug?: string | null;
  token: string;
  contextEnvironmentId?: string;
  runtimeTarget: RuntimeAgentTargetSelectionInput;
}): Promise<Record<string, string>> {
  if (!input.projectSlug) {
    throw new TypeError("Agent stream project context is required");
  }
  if (!input.token) {
    throw new AgentStreamEnvironmentSelectionError(
      503,
      "An API credential is required for this agent stream",
    );
  }
  const environmentId = await selectEnvironmentId({
    projectSlug: input.projectSlug,
    token: input.token,
    contextEnvironmentId: input.contextEnvironmentId,
    runtimeTarget: input.runtimeTarget,
  });
  const values = environmentId
    ? await environmentVariables.get(environmentId, input.token, input.projectSlug)
    : {};
  return {
    ...filterRuntimeProjectEnv(values),
    VERYFRONT_API_TOKEN: input.token,
    VERYFRONT_API_URL: resolveVeryfrontApiBaseUrlFromHostEnv(),
    VERYFRONT_PROJECT_SLUG: input.projectSlug,
  };
}
