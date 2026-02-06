/**
 * Projects Handler Module
 *
 * Handles the local projects discovery UI at root path when no project is selected.
 * Shows a list of discovered projects in standard directories.
 *
 * @module server/runtime-handler/projects-handler
 */

import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { localProjectCache, standardProjectDirs } from "./local-project-discovery.ts";
import type { ParsedDomain } from "../utils/domain-parser.ts";

/**
 * Check if the request should be handled by the projects discovery UI.
 */
export function shouldHandleProjectsUI(
  pathname: string,
  projectSlug: string | undefined,
  parsedDomain: ParsedDomain,
): boolean {
  const isProjectsPath = pathname === "/" ||
    pathname.startsWith("/_projects") ||
    pathname === "/_vf/api/projects";

  return (
    !projectSlug &&
    !parsedDomain.slug &&
    parsedDomain.isVeryfrontDomain &&
    isProjectsPath
  );
}

/**
 * Handle the projects discovery UI requests.
 * Returns a response or null if not handled.
 */
export async function handleProjectsRequest(
  req: Request,
  url: URL,
  ctx: HandlerContext,
): Promise<Response | null> {
  const pathname = url.pathname;

  // Projects shell HTML
  if (pathname === "/" || pathname === "/_projects" || pathname === "/_projects/") {
    const { PROJECTS_SHELL_HTML } = await import("../handlers/dev/projects/html-shell.ts");
    return new Response(PROJECTS_SHELL_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Projects UI assets
  if (pathname.startsWith("/_projects/ui/")) {
    const { handleProjectsUI } = await import("../handlers/dev/projects/ui-handler.ts");
    const response = await handleProjectsUI(req);
    if (response) return response;
  }

  // Projects API
  if (pathname.startsWith("/_projects/api/")) {
    const { handleProjectsAPI } = await import("../handlers/dev/projects/api.ts");
    const response = await handleProjectsAPI(req, ctx);
    if (response) return response;
  }

  // Local projects discovery API
  if (pathname === "/_vf/api/projects") {
    return await handleLocalProjectsDiscovery();
  }

  return new Response("Not found", { status: 404 });
}

/**
 * Discover and return local projects from standard directories.
 */
async function handleLocalProjectsDiscovery(): Promise<Response> {
  const nativeFs = createFileSystem();
  const basePath = cwd();

  for (const dir of standardProjectDirs) {
    try {
      const dirPath = `${basePath}/${dir}`;
      if (!(await nativeFs.exists(dirPath))) continue;

      for await (const entry of nativeFs.readDir(dirPath)) {
        if (entry.name.startsWith(".") || !entry.isDirectory) continue;

        const projectPath = `${dirPath}/${entry.name}`;
        try {
          const [hasApp, hasPages, hasComponents] = await Promise.all([
            nativeFs.exists(`${projectPath}/app`),
            nativeFs.exists(`${projectPath}/pages`),
            nativeFs.exists(`${projectPath}/components`),
          ]);

          if (hasApp || hasPages || hasComponents) {
            localProjectCache.set(entry.name, projectPath);
          }
        } catch {
          // Skip entries that can't be stat'd
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  const localProjects = Array.from(localProjectCache.entries()).map(([slug, path]) => ({
    id: slug,
    name: slug,
    slug,
    path,
    updated_at: new Date().toISOString(),
  }));

  return new Response(JSON.stringify({ data: localProjects }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
