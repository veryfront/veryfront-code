/**
 * Domain Parser Utility
 *
 * Extracts project slug from preview/development URLs.
 * Supports patterns:
 * - {slug}.preview.lvh.me:{port}
 * - {slug}.lvh.me:{port}
 * - {slug}.preview.veryfront.com
 * - {slug}.veryfront.com
 */

export interface ParsedDomain {
  slug: string | null;
  environment: "preview" | "development" | "staging" | "production" | null;
  isVeryfrontDomain: boolean;
}

/**
 * Extract project slug from domain/host header
 */
export function parseProjectDomain(host: string): ParsedDomain {
  // Remove port if present
  const domain = host.replace(/:\d+$/, "");

  // lvh.me local development: {slug}.preview.lvh.me or {slug}.lvh.me
  const lvhPreviewMatch = domain.match(/^([A-Za-z0-9-]+)\.preview\.lvh\.me$/);
  if (lvhPreviewMatch?.[1]) {
    return {
      slug: lvhPreviewMatch[1],
      environment: "preview",
      isVeryfrontDomain: true,
    };
  }

  const lvhMatch = domain.match(/^([A-Za-z0-9-]+)\.lvh\.me$/);
  if (lvhMatch?.[1]) {
    return {
      slug: lvhMatch[1],
      environment: "development",
      isVeryfrontDomain: true,
    };
  }

  // Veryfront.com/org domains
  const vfPreviewMatch = domain.match(/^([A-Za-z0-9-]+)\.preview\.veryfront\.(com|org)$/);
  if (vfPreviewMatch?.[1]) {
    return {
      slug: vfPreviewMatch[1],
      environment: "preview",
      isVeryfrontDomain: true,
    };
  }

  const vfStagingMatch = domain.match(/^([A-Za-z0-9-]+)\.staging\.veryfront\.(com|org)$/);
  if (vfStagingMatch?.[1]) {
    return {
      slug: vfStagingMatch[1],
      environment: "staging",
      isVeryfrontDomain: true,
    };
  }

  const vfProdMatch = domain.match(/^([A-Za-z0-9-]+)\.production\.veryfront\.(com|org)$/);
  if (vfProdMatch?.[1]) {
    return {
      slug: vfProdMatch[1],
      environment: "production",
      isVeryfrontDomain: true,
    };
  }

  const vfBaseMatch = domain.match(/^([A-Za-z0-9-]+)\.veryfront\.(com|org)$/);
  if (vfBaseMatch?.[1]) {
    return {
      slug: vfBaseMatch[1],
      environment: "production",
      isVeryfrontDomain: true,
    };
  }

  // Plain lvh.me without slug (localhost:port accessed via lvh.me)
  if (domain === "lvh.me") {
    return {
      slug: null,
      environment: "development",
      isVeryfrontDomain: true,
    };
  }

  // Not a recognized domain pattern
  return {
    slug: null,
    environment: null,
    isVeryfrontDomain: false,
  };
}

/**
 * Check if a domain is a valid veryfront domain
 */
export function isVeryfrontDomain(host: string): boolean {
  const domain = host.replace(/:\d+$/, "");
  const pattern = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.(veryfront\.com|veryfront\.org|lvh\.me)$/;
  return pattern.test(domain) || domain === "lvh.me";
}

/**
 * Get the effective project slug from request host or config
 */
export function getEffectiveProjectSlug(
  host: string,
  configuredSlug: string,
): { slug: string; fromHost: boolean } {
  const parsed = parseProjectDomain(host);

  if (parsed.slug) {
    return { slug: parsed.slug, fromHost: true };
  }

  return { slug: configuredSlug, fromHost: false };
}
