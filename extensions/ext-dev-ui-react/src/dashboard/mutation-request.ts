import {
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_CSRF_META_NAME,
  DASHBOARD_CSRF_TOKEN_PATTERN,
} from "veryfront/extensions/dev-ui/protocol";

interface DashboardMetaQueryRoot {
  querySelector(selector: string): {
    getAttribute(name: string): string | null;
  } | null;
}

/** Build the headers required for a privileged dashboard mutation. */
export function dashboardMutationHeaders(
  root: DashboardMetaQueryRoot = document,
): Headers {
  const meta = root.querySelector(`meta[name="${DASHBOARD_CSRF_META_NAME}"]`);
  const token = meta?.getAttribute("content") ?? "";
  if (!DASHBOARD_CSRF_TOKEN_PATTERN.test(token)) {
    throw new Error("Dashboard session token is missing or invalid; reload the dashboard");
  }

  return new Headers({
    "Content-Type": "application/json",
    [DASHBOARD_CSRF_HEADER_NAME]: token,
  });
}
