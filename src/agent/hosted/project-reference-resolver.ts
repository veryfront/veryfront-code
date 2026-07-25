import {
  getConfirmedAgentProjectIdentity,
  INVALID_AGENT_PROJECT_REFERENCE_MESSAGE,
  normalizeAgentProjectReference,
} from "../project/context.ts";
import { readToolResultOwnDataProperty } from "#veryfront/tool/result.ts";

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the primary lookup failure when connection cleanup also fails.
  }
}

/** Resolver for public project references used by hosted agent tools. */
export type HostedProjectReferenceResolver = (input: {
  projectReference: string;
  authToken: string;
  apiUrl: string;
  abortSignal?: AbortSignal;
}) => Promise<{ projectId: string; slug?: string | null }>;

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
    await cancelResponseBody(response);
    throw new Error(`Project lookup failed (${response.status})`);
  }

  const data: unknown = await response.json();
  const identity = getConfirmedAgentProjectIdentity({
    projectId: readToolResultOwnDataProperty(data, "id"),
    projectSlug: readToolResultOwnDataProperty(data, "slug"),
    requestedProjectReference: projectReference,
  });
  if (!identity) {
    throw new Error("Project lookup response did not confirm the requested project identity");
  }

  return {
    projectId: identity.projectId,
    slug: identity.projectSlug ?? null,
  };
}
