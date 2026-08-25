import { serveDevUiBundle } from "../shared/dev-ui-bundle-response.ts";

const PROJECTS_UI_BUNDLE_PATH = "/_projects/ui/index.js";

/** Serve the captured extension-owned projects bundle without runtime transforms. */
export function handleProjectsUI(
  req: Request,
  browserBundle?: string,
): Response | null {
  return serveDevUiBundle(req, PROJECTS_UI_BUNDLE_PATH, browserBundle);
}
