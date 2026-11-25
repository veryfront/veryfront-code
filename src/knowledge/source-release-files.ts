/**
 * Host-side lister for a shared agent's pinned source-release knowledge.
 *
 * @module knowledge/source-release-files
 * @internal
 */
import { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import type { SourceReleaseKnowledgeFile } from "./hosted-source-scope.ts";

/** The pinned release and the run-bound credential that may read it. */
export interface SourceReleaseKnowledgeTarget {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly releaseId: string;
  readonly authToken: string;
  /** Host-owned API base URL; the source credential is never sent anywhere else. */
  readonly apiUrl: string;
}

/** List the release's knowledge folder, keeping the credential inside the closure. */
export function createSourceReleaseKnowledgeLister(
  target: SourceReleaseKnowledgeTarget,
): () => Promise<readonly SourceReleaseKnowledgeFile[]> {
  const { projectId, projectSlug, releaseId, authToken, apiUrl } = target;
  return async () => {
    const client = new VeryfrontApiClient({
      apiBaseUrl: apiUrl,
      proxyMode: true,
      projectId,
      projectSlug,
    });
    client.setRequestToken(authToken);
    client.setProjectSlug(projectSlug);
    client.setContext({ type: "release", version: releaseId });
    return await client.listAllFiles({ path: "knowledge/", sortBy: "path", sortOrder: "asc" });
  };
}
