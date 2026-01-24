/****
 * Shared Error HTML Generator
 *
 * Generates styled error pages for 404, 500, and other HTTP errors.
 * Consolidated from multiple duplicate implementations to ensure consistency.
 */

export interface ErrorHtmlOptions {
  statusCode: number;
  title: string;
  message: string;
  /** Optional path to display in error message */
  pathname?: string;
  /** Use simple unstyled HTML (for minimal fallback) */
  minimal?: boolean;
}

/**
 * Generate a styled error page HTML.
 * Styled to match the Veryfront design system with dark mode support.
 */
export function generateErrorHtml(options: ErrorHtmlOptions): string {
  const { statusCode, title, message, pathname, minimal } = options;

  if (minimal) return generateMinimalErrorHtml(statusCode, title, message, pathname);

  return generateStyledErrorHtml(statusCode, title, message);
}

/**
 * Generate a styled error page with Veryfront design system.
 * Supports light/dark mode based on system preference or class.
 */
function generateStyledErrorHtml(statusCode: number, title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <link rel="icon" type="image/png" href="https://cdn.veryfront.com/images/veryfront-favicon.png">
  <title>${statusCode} ${title} — Veryfront</title>
  <style>
    :root {
      --bg: #ffffff;
      --title: #374151;
      --message: #9ca3af;
    }
    /* Dark mode: system preference, .dark class, or data-theme="dark" */
    @media (prefers-color-scheme: dark) {
      :root:not(.light):not([data-theme="light"]) {
        --bg: #0d0e11;
        --title: #949A9F;
        --message: #6b7280;
      }
    }
    :root.dark, :root[data-theme="dark"] {
      --bg: #0d0e11;
      --title: #949A9F;
      --message: #6b7280;
    }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .title {
      margin: 0 0 0.75rem;
      font-size: 1.875rem;
      font-weight: 500;
      color: var(--title);
      letter-spacing: -0.025em;
    }
    .message {
      margin: 0;
      font-size: 1rem;
      color: var(--message);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="title">${title}</h1>
    <p class="message">${message}</p>
  </div>
</body>
</html>`;
}

/**
 * Generate minimal unstyled error HTML.
 * Used as ultimate fallback when rendering completely fails.
 */
function generateMinimalErrorHtml(
  statusCode: number,
  title: string,
  message: string,
  pathname?: string,
): string {
  const fullMessage = pathname ? message.replace("{path}", ` "${pathname}"`) : message;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${statusCode} ${title}</title>
</head>
<body>
  <h1>${statusCode} ${title}</h1>
  <p>${fullMessage}</p>
</body>
</html>`;
}

/**
 * Common error configurations for quick use.
 */
export const ErrorPages = {
  notFound: (pathname?: string) =>
    generateErrorHtml({
      statusCode: 404,
      title: "Not Found",
      message: pathname
        ? `The page "${pathname}" could not be found.`
        : "The page you requested could not be found.",
    }),

  serverError: (message?: string) =>
    generateErrorHtml({
      statusCode: 500,
      title: "Internal Server Error",
      message: message ?? "Something went wrong while rendering this page.",
    }),

  undeployed: () =>
    generateErrorHtml({
      statusCode: 404,
      title: "Not Yet Deployed",
      message: "This project has not been deployed yet.",
    }),

  memoryPressure: () =>
    generateErrorHtml({
      statusCode: 503,
      title: "Service Temporarily Unavailable",
      message: "The server is experiencing high load. Please try again.",
    }),
};
