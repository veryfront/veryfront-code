import {
  type ConfirmedAgentProjectContextSwitch,
  getConfirmedResolvedAgentProjectIdentity,
  UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE,
} from "../project/context.ts";

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
  const response = await fetch(
    new URL(`/projects/${encodeURIComponent(input.projectReference)}`, input.apiUrl),
    {
      headers: { Authorization: `Bearer ${input.authToken}` },
      signal: input.abortSignal,
    },
  );
  if (!response.ok) {
    throw new Error(`Project lookup failed (${response.status})`);
  }

  const data = await response.json() as { id?: unknown; slug?: unknown };
  if (typeof data.id !== "string" || data.id.length === 0) {
    throw new Error("Project lookup response did not include project id");
  }

  const resolution = {
    projectId: data.id,
    slug: typeof data.slug === "string" ? data.slug : null,
  };
  const confirmed = requireConfirmedHostedProjectReference(
    resolution,
    input.projectReference,
  );
  return {
    projectId: confirmed.projectId,
    ...(confirmed.projectSlug === undefined ? {} : { slug: confirmed.projectSlug }),
  };
}
