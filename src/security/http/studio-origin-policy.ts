/** Hosted Studio origins trusted for iframe messaging and embedding. */
export const HOSTED_STUDIO_ORIGINS = [
  "https://veryfront.com",
  "https://veryfront.org",
] as const;

const hostedStudioOrigins = new Set<string>(HOSTED_STUDIO_ORIGINS);

// Replaced only when the host serves the pre-bundled Studio bridge. Keeping a
// fixed marker in the browser asset avoids reading project-controlled config.
export const OPERATOR_STUDIO_ORIGIN_MARKER = "__VF_OPERATOR_STUDIO_ORIGIN__";

/** A single administrator-selected Studio origin must be the platform root itself. */
export function parseOperatorStudioOrigin(
  raw: string | undefined,
  platformRoots: readonly string[],
): string | null {
  if (raw === undefined || raw === "") return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash &&
      url.origin === raw && platformRoots.includes(url.hostname)
    ) {
      return url.origin;
    }
  } catch {
    // Refuse malformed administrator configuration below.
  }
  throw new TypeError("PLATFORM_STUDIO_ORIGIN must be an exact HTTPS platform-root origin");
}

/** Resolve a trusted Studio origin, including localhost development origins. */
export function resolveTrustedStudioOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    const isWebProtocol = url.protocol === "http:" || url.protocol === "https:";

    if (isWebProtocol && url.hostname === "localhost") {
      return url.origin;
    }

    if (url.protocol === "https:" && hostedStudioOrigins.has(url.origin)) {
      return url.origin;
    }

    if (url.protocol === "https:" && url.origin === OPERATOR_STUDIO_ORIGIN_MARKER) {
      return url.origin;
    }
  } catch {
    // Invalid origins are untrusted.
  }

  return null;
}

/** Inline helper used by generated browser scripts. */
export function studioTargetOriginHelperSource(operatorOrigin: string | null = null): string {
  const hostedOrigins = JSON.stringify([
    ...HOSTED_STUDIO_ORIGINS,
    ...(operatorOrigin ? [operatorOrigin] : []),
  ]);

  return `
  function vfStudioTargetOrigin() {
    try {
      var referrer = new URL(document.referrer || '');
      var origin = referrer.origin;
      var hostedOrigins = ${hostedOrigins};
      var isLocalDevelopment =
        (referrer.protocol === 'http:' || referrer.protocol === 'https:') &&
        referrer.hostname === 'localhost';
      if (isLocalDevelopment ||
          (referrer.protocol === 'https:' && hostedOrigins.indexOf(origin) !== -1)) {
        return origin;
      }
    } catch (_) { /* referrer absent or invalid */ }
    return window.location.origin;
  }`;
}
