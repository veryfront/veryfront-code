/**
 * Domain Parser Utility
 *
 * Extracts project slug and branch from preview/development URLs.
 * Supports patterns:
 * - {slug}.preview.veryfront.dev:{port}
 * - {slug}--{branch}.preview.veryfront.dev:{port}
 * - {slug}.veryfront.dev:{port}
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

type Environment = ParsedDomain["environment"];

/**
 * Parse slug and optional branch from subdomain.
 * Branch pattern: {slug}--{branch} (double dash separator)
 */
function parseSlugAndBranch(subdomain: string): { slug: string; branch: string | null } {
  const separatorIndex = subdomain.indexOf("--");
  if (separatorIndex > 0) {
    return {
      slug: subdomain.substring(0, separatorIndex),
      branch: subdomain.substring(separatorIndex + 2),
    };
  }
  return { slug: subdomain, branch: null };
}

/** Create a ParsedDomain result with common defaults */
function createParsedDomain(
  slug: string | null,
  branch: string | null,
  environment: Environment,
  isVeryfrontDomain: boolean,
  isDraft: boolean,
): ParsedDomain {
  return { slug, branch, environment, isVeryfrontDomain, isDraft };
}

/**
 * Extract project slug and branch from domain/host header
 */
export function parseProjectDomain(host: string): ParsedDomain {
  // Remove port if present
  const domain = host.replace(/:\d+$/, "");

  // veryfront.dev local development: {slug}.preview.veryfront.dev or {slug}--{branch}.preview.veryfront.dev
  const devPreviewMatch = domain.match(/^([A-Za-z0-9-]+)\.preview\.veryfront\.dev$/);
  if (devPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(devPreviewMatch[1]);
    return createParsedDomain(slug, branch, "preview", true, true);
  }

  // Local production testing: {domain}.prod.veryfront.dev
  // This pattern is treated as a custom domain for JIT production rendering
  const devProdMatch = domain.match(/^([A-Za-z0-9.-]+)\.prod\.veryfront\.dev$/);
  if (devProdMatch?.[1]) {
    return createParsedDomain(null, null, "production", false, false);
  }

  const devMatch = domain.match(/^([A-Za-z0-9-]+)\.veryfront\.dev$/);
  if (devMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(devMatch[1]);
    return createParsedDomain(slug, branch, "development", true, true);
  }

  // Veryfront.com/org domains
  const vfPreviewMatch = domain.match(/^([A-Za-z0-9-]+)\.preview\.veryfront\.(com|org)$/);
  if (vfPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(vfPreviewMatch[1]);
    return createParsedDomain(slug, branch, "preview", true, true);
  }

  const vfStagingMatch = domain.match(/^([A-Za-z0-9-]+)\.staging\.veryfront\.(com|org)$/);
  if (vfStagingMatch?.[1]) {
    return createParsedDomain(vfStagingMatch[1], null, "staging", true, false);
  }

  const vfProdMatch = domain.match(/^([A-Za-z0-9-]+)\.production\.veryfront\.(com|org)$/);
  if (vfProdMatch?.[1]) {
    return createParsedDomain(vfProdMatch[1], null, "production", true, false);
  }

  // Handle environment-specific root domains (no project slug)
  // preview.veryfront.com, staging.veryfront.com, production.veryfront.com
  const vfEnvRootMatch = domain.match(/^(preview|staging|production)\.veryfront\.(com|org)$/);
  if (vfEnvRootMatch?.[1]) {
    const env = vfEnvRootMatch[1] as "preview" | "staging" | "production";
    return createParsedDomain(null, null, env, true, env === "preview");
  }

  const vfBaseMatch = domain.match(/^([A-Za-z0-9-]+)\.veryfront\.(com|org)$/);
  if (vfBaseMatch?.[1]) {
    return createParsedDomain(vfBaseMatch[1], null, "production", true, false);
  }

  // Plain veryfront.dev without slug
  if (domain === "veryfront.dev") {
    return createParsedDomain(null, null, "development", true, true);
  }

  // Not a recognized domain pattern
  return createParsedDomain(null, null, null, false, false);
}

/**
 * Check if a domain is a valid veryfront domain
 */
export function isVeryfrontDomain(host: string): boolean {
  const domain = host.replace(/:\d+$/, "");
  const pattern = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.(veryfront\.com|veryfront\.org|veryfront\.dev)$/;
  return pattern.test(domain) || domain === "veryfront.dev";
}

/**
 * Get the effective project slug from request host or config
 */
export function getEffectiveProjectSlug(
  host: string,
  configuredSlug: string,
): { slug: string; fromHost: boolean } {
  const { slug } = parseProjectDomain(host);
  return slug ? { slug, fromHost: true } : { slug: configuredSlug, fromHost: false };
}
