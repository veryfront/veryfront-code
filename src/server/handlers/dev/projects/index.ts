/**
 * Dev project-picker surface.
 *
 * This surface runs before project resolution. Keep its routing in the
 * pre-resolution runtime phase instead of registering a second route handler.
 *
 * @module server/handlers/dev/projects
 */

import type { HandlerContext } from "../../types.ts";
import { PROJECTS_SHELL_HTML } from "./html-shell.ts";
import { handleProjectsAPI } from "./api.ts";
import { handleProjectsUI } from "./ui-handler.ts";
import { createDevNotFoundResponse } from "../shared/not-found-response.ts";
import {
  createPrivateProjectsResponse,
  isAuthorizedProjectsRequest,
  withPrivateProjectsHeaders,
} from "./request-policy.ts";

function isProjectsSurfacePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/_projects" || pathname.startsWith("/_projects/");
}

/** Handle the project-picker shell, UI modules, and configuration API. */
export async function handleProjectsSurfaceRequest(
  req: Request,
  ctx: HandlerContext,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!isProjectsSurfacePath(pathname)) return null;

  if (!isAuthorizedProjectsRequest(req)) {
    return createPrivateProjectsResponse("Unauthorized", 401);
  }
  if (req.method.toUpperCase() !== "GET") {
    return createPrivateProjectsResponse("Method Not Allowed", 405, { "Allow": "GET" });
  }

  if (pathname === "/" || pathname === "/_projects" || pathname === "/_projects/") {
    return createPrivateProjectsResponse(PROJECTS_SHELL_HTML, 200, {
      "Content-Type": "text/html; charset=utf-8",
    });
  }

  if (pathname.startsWith("/_projects/ui/")) {
    const response = await handleProjectsUI(req);
    return withPrivateProjectsHeaders(response ?? createDevNotFoundResponse());
  }

  if (pathname.startsWith("/_projects/api/")) {
    const response = handleProjectsAPI(req, ctx);
    return withPrivateProjectsHeaders(response ?? createDevNotFoundResponse());
  }

  return withPrivateProjectsHeaders(createDevNotFoundResponse());
}
