/**
 * Domain Parser Utility
 *
 * Extracts project slug and branch from preview/development URLs.
 * Supports patterns:
 * - {slug}.preview.lvh.me:{port}
 * - {slug}--{branch}.preview.lvh.me:{port}
 * - {slug}.lvh.me:{port}
 * - {slug}.preview.veryfront.com
 * - {slug}--{branch}.preview.veryfront.com
 * - {slug}.veryfront.com
 */

export interface ParsedDomain {
  slug: string | null;
  branch: string | null;
  environment: "preview" | "development" | "staging" | "production" | null;
  isVeryfrontDomain: boolean;
  isDraft: boolean;
}

/**
 * Parse slug and optional branch from subdomain.
 * Branch pattern: {slug}--{branch} (double dash separator)
 */
function parseSlugAndBranch(subdomain: string): { slug: string; branch: string | null } {
  const branchSeparator = "--";
  const separatorIndex = subdomain.indexOf(branchSeparator);

  if (separatorIndex > 0) {
    return {
      slug: subdomain.substring(0, separatorIndex),
      branch: subdomain.substring(separatorIndex + branchSeparator.length),
    };
  }

  return { slug: subdomain, branch: null };
}

/**
 * Extract project slug and branch from domain/host header
 */
export function parseProjectDomain(host: string): ParsedDomain {
  // Remove port if present
  const domain = host.replace(/:\d+$/, "");

  // lvh.me local development: {slug}.preview.lvh.me or {slug}--{branch}.preview.lvh.me
  const lvhPreviewMatch = domain.match(/^([A-Za-z0-9-]+)\.preview\.lvh\.me$/);
  if (lvhPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(lvhPreviewMatch[1]);
    return {
      slug,
      branch,
      environment: "preview",
      isVeryfrontDomain: true,
      isDraft: true,
    };
  }

  // Local production testing: {domain}.prod.lvh.me
  // This pattern is treated as a custom domain for JIT production rendering
  const lvhProdMatch = domain.match(/^([A-Za-z0-9.-]+)\.prod\.lvh\.me$/);
  if (lvhProdMatch?.[1]) {
    return {
      slug: null, // No slug - will trigger domain lookup
      branch: null,
      environment: "production",
      isVeryfrontDomain: false, // Custom domain
      isDraft: false,
    };
  }

  const lvhMatch = domain.match(/^([A-Za-z0-9-]+)\.lvh\.me$/);
  if (lvhMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(lvhMatch[1]);
    return {
      slug,
      branch,
      environment: "development",
      isVeryfrontDomain: true,
      isDraft: true,
    };
  }

  // Veryfront.com/org domains
  const vfPreviewMatch = domain.match(/^([A-Za-z0-9-]+)\.preview\.veryfront\.(com|org)$/);
  if (vfPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(vfPreviewMatch[1]);
    return {
      slug,
      branch,
      environment: "preview",
      isVeryfrontDomain: true,
      isDraft: true,
    };
  }

  const vfStagingMatch = domain.match(/^([A-Za-z0-9-]+)\.staging\.veryfront\.(com|org)$/);
  if (vfStagingMatch?.[1]) {
    return {
      slug: vfStagingMatch[1],
      branch: null,
      environment: "staging",
      isVeryfrontDomain: true,
      isDraft: false,
    };
  }

  const vfProdMatch = domain.match(/^([A-Za-z0-9-]+)\.production\.veryfront\.(com|org)$/);
  if (vfProdMatch?.[1]) {
    return {
      slug: vfProdMatch[1],
      branch: null,
      environment: "production",
      isVeryfrontDomain: true,
      isDraft: false,
    };
  }

  const vfBaseMatch = domain.match(/^([A-Za-z0-9-]+)\.veryfront\.(com|org)$/);
  if (vfBaseMatch?.[1]) {
    return {
      slug: vfBaseMatch[1],
      branch: null,
      environment: "production",
      isVeryfrontDomain: true,
      isDraft: false,
    };
  }

  // Plain lvh.me without slug (localhost:port accessed via lvh.me)
  if (domain === "lvh.me") {
    return {
      slug: null,
      branch: null,
      environment: "development",
      isVeryfrontDomain: true,
      isDraft: true,
    };
  }

  // Not a recognized domain pattern
  return {
    slug: null,
    branch: null,
    environment: null,
    isVeryfrontDomain: false,
    isDraft: false,
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
