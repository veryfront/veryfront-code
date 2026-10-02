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
  let basePath = url.pathname;
  if (basePath.endsWith("/")) basePath = basePath.slice(0, -1);
  if (basePath.endsWith("/mcp")) {
    basePath = basePath.slice(0, -4);
    const projectSegment = basePath.lastIndexOf("/projects/");
    if (
      projectSegment >= 0 && basePath.length > projectSegment + 10 &&
      !basePath.slice(projectSegment + 10).includes("/")
    ) {
      basePath = basePath.slice(0, projectSegment);
    }
  }
  let end = basePath.length;
  while (end > 0 && basePath[end - 1] === "/") end--;
  basePath = basePath.slice(0, end);
  url.pathname = `${basePath}/projects/${encodeURIComponent(normalizedProjectId)}/mcp`;
  return url.toString();
}
