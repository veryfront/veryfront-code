export interface ParsedDomain {
  slug: string | null;
  branch: string | null;
  environment: "preview" | "development" | "staging" | "production" | null;
  isVeryfrontDomain: boolean;
  isDraft: boolean;
  /** Whether this domain allows iframe embedding (veryfront, localhost, xip.io, zip.io) */
  allowIframeEmbed: boolean;
}

type Environment = ParsedDomain["environment"];

// Local development domains (veryfront.me preferred, lvh.me alternative, veryfront.dev for HTTPS testing)
// `localhost` included so that {slug}.localhost URLs work — *.localhost is a W3C Secure Context,
// enabling navigator.mediaDevices / getUserMedia in WKWebView (Tauri) and all browsers.
const LOCAL_DEV_DOMAINS = "veryfront\\.me|lvh\\.me|veryfront\\.dev|localhost";
// Production domains
const PROD_DOMAINS = "veryfront\\.com|veryfront\\.org";

// Domains that allow iframe embedding but aren't veryfront domains
const IFRAME_EMBED_DOMAINS = /^(localhost|.*\.xip\.io|.*\.zip\.io)$/i;

/** All recognized veryfront domains */
const ALL_DOMAINS = `${LOCAL_DEV_DOMAINS}|${PROD_DOMAINS}`;

function stripPort(host: string): string {
  return host.replace(/:\d+$/, "");
}

/**
 * Parse slug and optional branch from subdomain.
 * Branch pattern: {slug}--{branch} (double dash separator)
 */
function parseSlugAndBranch(subdomain: string): { slug: string; branch: string | null } {
  const separatorIndex = subdomain.indexOf("--");
  if (separatorIndex <= 0) return { slug: subdomain, branch: null };

  return {
    slug: subdomain.substring(0, separatorIndex),
    branch: subdomain.substring(separatorIndex + 2),
  };
}

/** Create a ParsedDomain result with common defaults */
function createParsedDomain(
  slug: string | null,
  branch: string | null,
  environment: Environment,
  isVeryfrontDomain: boolean,
  isDraft: boolean,
  allowIframeEmbed?: boolean,
): ParsedDomain {
  return {
    slug,
    branch,
    environment,
    isVeryfrontDomain,
    isDraft,
    allowIframeEmbed: allowIframeEmbed ?? isVeryfrontDomain,
  };
}

function matchDomain(domain: string, pattern: string): RegExpMatchArray | null {
  return domain.match(new RegExp(pattern));
}

/**
 * Extract project slug and branch from domain/host header
 */
export function parseProjectDomain(host: string): ParsedDomain {
  const domain = stripPort(host);

  if (IFRAME_EMBED_DOMAINS.test(domain)) {
    return createParsedDomain(null, null, "development", false, true, true);
  }

  // Plain local dev domains without slug
  if (domain === "veryfront.me" || domain === "veryfront.dev" || domain === "lvh.me") {
    return createParsedDomain(null, null, "development", true, true);
  }

  // Local development preview: {slug}.preview.{lvh.me|veryfront.dev}
  const localPreviewMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.preview\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(localPreviewMatch[1]);
    return createParsedDomain(slug, branch, "preview", true, true);
  }

  // Local production testing: {custom-domain}.prod.{lvh.me|veryfront.dev}
  // Treated as custom domain for JIT production rendering
  const localProdMatch = matchDomain(
    domain,
    `^([A-Za-z0-9.-]+)\\.prod\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localProdMatch?.[1]) {
    return createParsedDomain(null, null, "production", false, false);
  }

  // Local development explicit production: {slug}.production.{lvh.me|veryfront.dev}
  const localProductionMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.production\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localProductionMatch?.[1]) {
    return createParsedDomain(localProductionMatch[1], null, "production", true, false);
  }

  // Local development explicit staging: {slug}.staging.{lvh.me|veryfront.dev}
  const localStagingMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.staging\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localStagingMatch?.[1]) {
    return createParsedDomain(localStagingMatch[1], null, "staging", true, false);
  }

  // Local environment root domains (no slug): preview|staging|production.{lvh.me|veryfront.dev}
  const localEnvRootMatch = matchDomain(
    domain,
    `^(preview|staging|production)\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localEnvRootMatch?.[1]) {
    const env = localEnvRootMatch[1] as Environment;
    return createParsedDomain(null, null, env, true, env === "preview");
  }

  // Local development base: {slug}.{lvh.me|veryfront.dev}
  // Mirrors production behavior: serves released content (isDraft: false)
  // Use {slug}.preview.lvh.me for draft content
  const localBaseMatch = matchDomain(domain, `^([A-Za-z0-9-]+)\\.(${LOCAL_DEV_DOMAINS})$`);
  if (localBaseMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(localBaseMatch[1]);
    return createParsedDomain(slug, branch, "production", true, false);
  }

  // Production preview: {slug}.preview.veryfront.{com|org}
  const prodPreviewMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.preview\\.(${PROD_DOMAINS})$`,
  );
  if (prodPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(prodPreviewMatch[1]);
    return createParsedDomain(slug, branch, "preview", true, true);
  }

  // Production staging: {slug}.staging.veryfront.{com|org}
  const prodStagingMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.staging\\.(${PROD_DOMAINS})$`,
  );
  if (prodStagingMatch?.[1]) {
    return createParsedDomain(prodStagingMatch[1], null, "staging", true, false);
  }

  // Production explicit: {slug}.production.veryfront.{com|org}
  const prodExplicitMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.production\\.(${PROD_DOMAINS})$`,
  );
  if (prodExplicitMatch?.[1]) {
    return createParsedDomain(prodExplicitMatch[1], null, "production", true, false);
  }

  // Environment root domains (no slug): preview|staging|production.veryfront.{com|org}
  const envRootMatch = matchDomain(domain, `^(preview|staging|production)\\.(${PROD_DOMAINS})$`);
  if (envRootMatch?.[1]) {
    const env = envRootMatch[1] as Environment;
    return createParsedDomain(null, null, env, true, env === "preview");
  }

  return createParsedDomain(null, null, null, false, false);
}

/**
 * Check if a domain is a valid veryfront domain (includes veryfront.me and lvh.me for local dev)
 */
export function isVeryfrontDomain(host: string): boolean {
  const domain = stripPort(host);

  if (domain === "veryfront.me" || domain === "veryfront.dev" || domain === "lvh.me") return true;

  return new RegExp(`^[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)*\\.(${ALL_DOMAINS})$`).test(domain);
}

/**
 * Get the effective project slug from request host or config
 */
export function getEffectiveProjectSlug(
  host: string,
  configuredSlug: string,
): { slug: string; fromHost: boolean } {
  const { slug } = parseProjectDomain(host);
  if (slug) return { slug, fromHost: true };
  return { slug: configuredSlug, fromHost: false };
}
