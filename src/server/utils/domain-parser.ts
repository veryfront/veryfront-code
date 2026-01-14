/**
 * Domain Parser Utility
 *
 * Extracts project slug and branch from preview/development URLs.
 * Supports patterns:
 * - {slug}.lvh.me:{port} (local development - recommended)
 * - {slug}.preview.lvh.me:{port}
 * - {slug}.preview.veryfront.dev:{port}
 * - {slug}--{branch}.preview.veryfront.dev:{port}
 * - {slug}.veryfront.dev:{port}
 * - {slug}.preview.veryfront.com
 * - {slug}--{branch}.preview.veryfront.com
 * - {slug}.veryfront.com
 *
 * Note: lvh.me is preferred for local dev because .dev TLD forces HTTPS in browsers.
 */

export interface ParsedDomain {
  slug: string | null;
  branch: string | null;
  environment: "preview" | "development" | "staging" | "production" | null;
  isVeryfrontDomain: boolean;
  isDraft: boolean;
}

type Environment = ParsedDomain["environment"];

// Local development domains (lvh.me resolves to 127.0.0.1, veryfront.dev for HTTPS testing)
const LOCAL_DEV_DOMAINS = "lvh\\.me|veryfront\\.dev";
// Production domains
const PROD_DOMAINS = "veryfront\\.com|veryfront\\.org";

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

  // Local development preview: {slug}.preview.{lvh.me|veryfront.dev}
  const localPreviewMatch = domain.match(
    new RegExp(`^([A-Za-z0-9-]+)\\.preview\\.(${LOCAL_DEV_DOMAINS})$`),
  );
  if (localPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(localPreviewMatch[1]);
    return createParsedDomain(slug, branch, "preview", true, true);
  }

  // Local production testing: {custom-domain}.prod.{lvh.me|veryfront.dev}
  // Treated as custom domain for JIT production rendering
  const localProdMatch = domain.match(
    new RegExp(`^([A-Za-z0-9.-]+)\\.prod\\.(${LOCAL_DEV_DOMAINS})$`),
  );
  if (localProdMatch?.[1]) {
    return createParsedDomain(null, null, "production", false, false);
  }

  // Local development base: {slug}.{lvh.me|veryfront.dev}
  const localBaseMatch = domain.match(new RegExp(`^([A-Za-z0-9-]+)\\.(${LOCAL_DEV_DOMAINS})$`));
  if (localBaseMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(localBaseMatch[1]);
    return createParsedDomain(slug, branch, "development", true, true);
  }

  // Plain local dev domains without slug
  if (domain === "veryfront.dev" || domain === "lvh.me") {
    return createParsedDomain(null, null, "development", true, true);
  }

  // Production preview: {slug}.preview.veryfront.{com|org}
  const prodPreviewMatch = domain.match(
    new RegExp(`^([A-Za-z0-9-]+)\\.preview\\.(${PROD_DOMAINS})$`),
  );
  if (prodPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(prodPreviewMatch[1]);
    return createParsedDomain(slug, branch, "preview", true, true);
  }

  // Production staging: {slug}.staging.veryfront.{com|org}
  const prodStagingMatch = domain.match(
    new RegExp(`^([A-Za-z0-9-]+)\\.staging\\.(${PROD_DOMAINS})$`),
  );
  if (prodStagingMatch?.[1]) {
    return createParsedDomain(prodStagingMatch[1], null, "staging", true, false);
  }

  // Production explicit: {slug}.production.veryfront.{com|org}
  const prodExplicitMatch = domain.match(
    new RegExp(`^([A-Za-z0-9-]+)\\.production\\.(${PROD_DOMAINS})$`),
  );
  if (prodExplicitMatch?.[1]) {
    return createParsedDomain(prodExplicitMatch[1], null, "production", true, false);
  }

  // Environment root domains (no slug): preview|staging|production.veryfront.{com|org}
  const envRootMatch = domain.match(
    new RegExp(`^(preview|staging|production)\\.(${PROD_DOMAINS})$`),
  );
  if (envRootMatch?.[1]) {
    const env = envRootMatch[1] as "preview" | "staging" | "production";
    return createParsedDomain(null, null, env, true, env === "preview");
  }

  // Production base: {slug}.veryfront.{com|org}
  const prodBaseMatch = domain.match(new RegExp(`^([A-Za-z0-9-]+)\\.(${PROD_DOMAINS})$`));
  if (prodBaseMatch?.[1]) {
    return createParsedDomain(prodBaseMatch[1], null, "production", true, false);
  }

  // Not a recognized domain pattern
  return createParsedDomain(null, null, null, false, false);
}

/** All recognized veryfront domains */
const ALL_DOMAINS = `${LOCAL_DEV_DOMAINS}|${PROD_DOMAINS}`;

/**
 * Check if a domain is a valid veryfront domain (includes lvh.me for local dev)
 */
export function isVeryfrontDomain(host: string): boolean {
  const domain = host.replace(/:\d+$/, "");
  const pattern = new RegExp(`^[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)*\\.(${ALL_DOMAINS})$`);
  return pattern.test(domain) || domain === "veryfront.dev" || domain === "lvh.me";
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
