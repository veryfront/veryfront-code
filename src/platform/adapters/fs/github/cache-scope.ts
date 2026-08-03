import type { ResolvedGitHubConfig } from "./types.ts";

/**
 * Build the repository-scoped value passed to the shared GitHub cache-key
 * builders. File caches can use a process-wide distributed backend, so a ref
 * alone is not sufficient to isolate repositories with matching paths.
 */
export function buildGitHubCacheRef(
  config: Pick<ResolvedGitHubConfig, "owner" | "repo" | "ref">,
): string {
  return [
    encodeURIComponent(config.owner),
    encodeURIComponent(config.repo),
    encodeURIComponent(config.ref),
  ].join(":");
}
