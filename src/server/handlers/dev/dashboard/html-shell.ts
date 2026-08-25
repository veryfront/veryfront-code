import {
  DASHBOARD_CSRF_META_NAME,
  DASHBOARD_CSRF_TOKEN_PATTERN,
  DEV_UI_KIND_ATTRIBUTE,
} from "#veryfront/extensions/dev-ui/protocol";

export const DASHBOARD_SHELL_HTML = `<!DOCTYPE html>
<html lang="en" ${DEV_UI_KIND_ATTRIBUTE}="dashboard">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Veryfront Dev</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/_dev/ui/index.js"></script>
</body>
</html>`;

export function createDashboardShellHtml(csrfToken: string): string {
  if (!DASHBOARD_CSRF_TOKEN_PATTERN.test(csrfToken)) {
    throw new TypeError("Dashboard CSRF token must be a 256-bit base64url value");
  }
  return DASHBOARD_SHELL_HTML.replace(
    "<title>Veryfront Dev</title>",
    `<title>Veryfront Dev</title>\n  <meta name="${DASHBOARD_CSRF_META_NAME}" content="${csrfToken}">`,
  );
}
