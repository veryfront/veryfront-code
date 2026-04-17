export function parseStatusFromError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/failed: (\d+)/);
  return match ? Number(match[1]) : null;
}

// Brittle on purpose: we string-match the API's OAuth error body. Source of truth is
// veryfront-api/src/api/http/rest/auth/routes.ts — `oauthError(c, 'Project not found
// for domain', ...)`. If that string is renamed, this regex silently regresses to 502.
// Durable fix is a typed error code from the token-mint helper; tracked separately.
export function isMissingCustomDomainProjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /project not found for domain/i.test(message);
}

export function makeAuthRedirectUrl(req: Request): string {
  const url = new URL(req.url);
  // Collapse leading slashes to prevent protocol-relative open redirects (e.g. "//evil.com/path")
  const safePath = url.pathname.replace(/^\/\/+/, "/");
  let returnPath = safePath + url.search;

  // Ensure the return path stays within the application and is not an absolute URL.
  // - It must start with "/".
  // - It must not contain a scheme delimiter ("://").
  // If it fails validation, fall back to the root path.
  if (!returnPath.startsWith("/") || returnPath.includes("://")) {
    returnPath = "/";
  }

  return `https://veryfront.com/sign-in?from=${encodeURIComponent(returnPath)}`;
}
