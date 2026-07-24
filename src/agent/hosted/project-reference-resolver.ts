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

  return {
    projectId: data.id,
    slug: typeof data.slug === "string" ? data.slug : null,
  };
}
