import {
  type ConfirmedAgentProjectContextSwitch,
  getConfirmedAgentProjectIdentity,
  getConfirmedResolvedAgentProjectIdentity,
  INVALID_AGENT_PROJECT_REFERENCE_MESSAGE,
  normalizeAgentProjectReference,
  UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE,
} from "../project/context.ts";
import { readOwnDataProperty as readRuntimeOwnDataProperty } from "../runtime/data-property-descriptor.ts";
import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

const ArrayIsArray = Array.isArray;

/**
 * Read an own data property from untrusted JSON without invoking accessors or
 * walking the prototype chain.
 */
export function canReadHostedProjectLookupDataProperties(
  source: unknown,
  proxyDetectionAvailable = canIdentifyProxyWithoutHooks,
): source is object {
  if (typeof source !== "object" || source === null || ArrayIsArray(source)) {
    return false;
  }
  if (!proxyDetectionAvailable) {
    return false;
  }
  return !isProxyWithoutHooks(source);
}

function readOwnDataProperty(source: unknown, key: string): unknown {
  if (!canReadHostedProjectLookupDataProperties(source)) {
    return undefined;
  }

  try {
    return readRuntimeOwnDataProperty(source, key, "project lookup response", false);
  } catch {
    return undefined;
  }
}

function cancelResponseBodyWithoutWaiting(response: Response): void {
  let cancellation: Promise<void> | undefined;
  try {
    cancellation = response.body?.cancel();
  } catch {
    // Preserve the primary lookup failure when connection cleanup also fails.
  }
  void cancellation?.catch(() => undefined);
}

/** Resolver for public project references used by hosted agent tools. */
export type HostedProjectReferenceResolver = (input: {
  projectReference: string;
  authToken: string;
  apiUrl: string;
  abortSignal?: AbortSignal;
}) => Promise<{ projectId: string; slug?: string | null }>;

/** Confirm one resolver result against the exact requested public reference. */
export function requireConfirmedHostedProjectReference(
  resolution: unknown,
  requestedProjectReference: string,
): ConfirmedAgentProjectContextSwitch {
  const confirmed = getConfirmedResolvedAgentProjectIdentity(
    resolution,
    requestedProjectReference,
  );
  if (!confirmed) {
    throw new TypeError(UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE);
  }
  return confirmed;
}

/** Resolve a public project UUID or slug through the API boundary. */
export async function resolveHostedProjectReference(input: {
  projectReference: string;
  authToken: string;
  apiUrl: string;
  abortSignal?: AbortSignal;
}): Promise<{ projectId: string; slug?: string | null }> {
  const projectReference = normalizeAgentProjectReference(input.projectReference);
  if (!projectReference) {
    throw new TypeError(INVALID_AGENT_PROJECT_REFERENCE_MESSAGE);
  }

  const response = await fetch(
    new URL(`/projects/${encodeURIComponent(projectReference)}`, input.apiUrl),
    {
      headers: { Authorization: `Bearer ${input.authToken}` },
      signal: input.abortSignal,
    },
  );
  if (!response.ok) {
    cancelResponseBodyWithoutWaiting(response);
    throw new Error(`Project lookup failed (${response.status})`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Project lookup response did not confirm the requested project identity");
  }
  const identity = getConfirmedAgentProjectIdentity({
    projectId: readOwnDataProperty(data, "id"),
    projectSlug: readOwnDataProperty(data, "slug"),
    requestedProjectReference: projectReference,
  });
  // The response must name the project that was asked for; a lookup that
  // answers with a different identity must not silently retarget the caller.
  if (!identity) {
    throw new Error("Project lookup response did not confirm the requested project identity");
  }

  const resolution = {
    projectId: identity.projectId,
    slug: identity.projectSlug ?? null,
  };
  const confirmed = requireConfirmedHostedProjectReference(
    resolution,
    projectReference,
  );
  return {
    projectId: confirmed.projectId,
    ...(confirmed.projectSlug === undefined ? {} : { slug: confirmed.projectSlug }),
  };
}
