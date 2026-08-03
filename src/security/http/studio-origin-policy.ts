/** Hosted Studio origins trusted for iframe messaging and embedding. */
export const HOSTED_STUDIO_ORIGINS = [
  "https://veryfront.com",
  "https://veryfront.org",
] as const;

const hostedStudioOrigins = new Set<string>(HOSTED_STUDIO_ORIGINS);

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
  } catch {
    // Invalid origins are untrusted.
  }

  return null;
}

/** Inline helper used by generated browser scripts. */
export function studioTargetOriginHelperSource(): string {
  const hostedOrigins = JSON.stringify(HOSTED_STUDIO_ORIGINS);

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
