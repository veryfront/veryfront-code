import { serveDevUiBundle } from "../shared/dev-ui-bundle-response.ts";

const DASHBOARD_UI_BUNDLE_PATH = "/_dev/ui/index.js";

/** Serve the captured extension-owned dashboard bundle without runtime transforms. */
export function handleDashboardUI(
  req: Request,
  browserBundle?: string,
): Response | null {
  return serveDevUiBundle(req, DASHBOARD_UI_BUNDLE_PATH, browserBundle);
}
