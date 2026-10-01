/** Build the project-scoped control-plane MCP URL for the active project. */
export function createProjectScopedMcpUrl(
  apiMcpUrl: string,
  projectId: string | null | undefined,
): string {
  const normalizedProjectId = projectId?.trim();
  if (!normalizedProjectId) return apiMcpUrl;

  let url: URL;
  try {
    url = new URL(apiMcpUrl);
  } catch {
    // Let the remote MCP boundary produce its standard configuration error.
    return apiMcpUrl;
  }
  const basePath = url.pathname
    .replace(/\/projects\/[^/]+\/mcp\/?$/, "")
    .replace(/\/mcp\/?$/, "")
    .replace(/\/+$/, "");
  url.pathname = `${basePath}/projects/${encodeURIComponent(normalizedProjectId)}/mcp`;
  return url.toString();
}
