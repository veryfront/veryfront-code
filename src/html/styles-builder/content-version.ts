import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";

interface ContentVersionFallback {
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
}

export function resolveStyleContentVersion(
  contentContext: ResolvedContentContext | null,
  fallback: ContentVersionFallback = {},
): string {
  if (contentContext?.releaseId) return `release:${contentContext.releaseId}`;
  if (contentContext?.branch) return `branch:${contentContext.branch}`;
  if (contentContext?.environmentName) return `environment:${contentContext.environmentName}`;
  if (fallback.releaseId) return `release:${fallback.releaseId}`;
  if (fallback.branch) return `branch:${fallback.branch}`;
  if (fallback.environmentName) return `environment:${fallback.environmentName}`;
  return "live";
}
