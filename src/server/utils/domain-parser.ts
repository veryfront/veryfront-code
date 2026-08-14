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

// Local development domain. `localhost` is the only one: it is the hostname the CLI prints,
// it is reserved by RFC 6761 so it never leaves the machine, and *.localhost is a W3C Secure
// Context, enabling navigator.mediaDevices / getUserMedia in WKWebView (Tauri) and all browsers.
//
// Public wildcard-DNS roots that resolve to 127.0.0.1 were removed deliberately: they are real
// DNS names, so DNS rebind protection blocks them and the local stack becomes unreachable with
// no actionable error. `localhost` is a *single-label* root with no registrable domain, so every
// rule below matches it as a root in its own right rather than via an eTLD+1 style
// "last two labels" split.
const LOCAL_DEV_DOMAINS = "localhost";
// Production domains
const PROD_DOMAINS = "veryfront\\.com|veryfront\\.org";

// Domains that allow iframe embedding but aren't veryfront domains
const IFRAME_EMBED_DOMAINS = /^(localhost|.*\.xip\.io|.*\.zip\.io)$/i;

/**
 * Environment labels that `{slug}.{environment}.veryfront.com` actually routes.
 *
 * This is not a naming preference — it is what the hosted platform can serve.
 * Each label needs a wildcard TLS certificate (`*.{label}.veryfront.com`) and a
 * rule below that resolves the host to a project. A label with neither is not a
 * slow environment, it is an unreachable one: TLS fails outright, or the proxy
 * falls through to the custom-domain lookup and answers
 * `404 {"error":"No project configured for domain: ..."}`.
 *
 * `development` is deliberately absent. It is a valid `ParsedDomain.environment`
 * for the *local* root (`localhost`), where it means
 * "running on this machine". No hosted rule produces it, so a hosted
 * `{slug}.development.veryfront.com` resolves to no project.
 *
 * Keep in sync with the hosted rules in `parseProjectDomain`; the lock test in
 * `domain-parser.test.ts` fails if they drift apart.
 */
export const HOSTED_ENVIRONMENT_NAMES = ["preview", "staging", "production"] as const;

export type HostedEnvironmentName = typeof HOSTED_ENVIRONMENT_NAMES[number];

/**
 * Whether `{slug}.{name}.veryfront.com` is a host the platform can route.
 *
 * Deliberately not a `name is HostedEnvironmentName` predicate. Host labels are
 * case-insensitive, so the comparison folds case — and a predicate would then
 * narrow the *unfolded* `"Production"` to a type whose members are all
 * lowercase, letting a caller feed it to an exhaustive `switch` or a keyed
 * lookup that misses at runtime. A caller that needs a value of that type must
 * take the folded label this is built on rather than its own string.
 */
export function isHostedEnvironmentName(name: string): boolean {
  return toHostedEnvironmentName(name) !== null;
}

/**
 * The routable label `name` denotes, case-folded, or null when the platform
 * cannot route it. Returns the constant rather than the caller's string, so the
 * value always matches its `HostedEnvironmentName` type.
 */
function toHostedEnvironmentName(name: string): HostedEnvironmentName | null {
  const folded = name.toLowerCase();
  return HOSTED_ENVIRONMENT_NAMES.find((hosted) => hosted === folded) ?? null;
}

/** Alternation source for the hosted environment labels, e.g. `preview|staging|production`. */
const HOSTED_ENVIRONMENTS = HOSTED_ENVIRONMENT_NAMES.join("|");

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

  // Plain local dev domain without slug.
  // Bare `localhost` is checked here, ahead of IFRAME_EMBED_DOMAINS, so that it is a full
  // veryfront local-dev root: a project-less local host is how the project chooser is
  // reached, and it must not fall through to the custom-domain lookup path.
  if (domain === "localhost") {
    return createParsedDomain(null, null, "development", true, true);
  }

  if (IFRAME_EMBED_DOMAINS.test(domain)) {
    return createParsedDomain(null, null, "development", false, true, true);
  }

  // Local development preview: {slug}.preview.localhost
  const localPreviewMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.preview\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localPreviewMatch?.[1]) {
    const { slug, branch } = parseSlugAndBranch(localPreviewMatch[1]);
    return createParsedDomain(slug, branch, "preview", true, true);
  }

  // Local production testing: {custom-domain}.prod.localhost
  // Treated as custom domain for JIT production rendering
  const localProdMatch = matchDomain(
    domain,
    `^([A-Za-z0-9.-]+)\\.prod\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localProdMatch?.[1]) {
    return createParsedDomain(null, null, "production", false, false);
  }

  // Local development explicit production: {slug}.production.localhost
  const localProductionMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.production\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localProductionMatch?.[1]) {
    return createParsedDomain(localProductionMatch[1], null, "production", true, false);
  }

  // Local development explicit staging: {slug}.staging.localhost
  const localStagingMatch = matchDomain(
    domain,
    `^([A-Za-z0-9-]+)\\.staging\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localStagingMatch?.[1]) {
    return createParsedDomain(localStagingMatch[1], null, "staging", true, false);
  }

  // Local environment root domains (no slug): preview|staging|production.localhost
  const localEnvRootMatch = matchDomain(
    domain,
    `^(${HOSTED_ENVIRONMENTS})\\.(${LOCAL_DEV_DOMAINS})$`,
  );
  if (localEnvRootMatch?.[1]) {
    const env = localEnvRootMatch[1] as Environment;
    return createParsedDomain(null, null, env, true, env === "preview");
  }

  // Local development base: {slug}.localhost
  // Mirrors production behavior: serves released content (isDraft: false)
  // Use {slug}.preview.localhost for draft content
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
  const envRootMatch = matchDomain(domain, `^(${HOSTED_ENVIRONMENTS})\\.(${PROD_DOMAINS})$`);
  if (envRootMatch?.[1]) {
    const env = envRootMatch[1] as Environment;
    return createParsedDomain(null, null, env, true, env === "preview");
  }

  // Intentionally NOT supported: bare {slug}.veryfront.{com,org}. Projects must use the
  // explicit {slug}.production.veryfront.com form. Do not re-add — this has been tried
  // and reverted (PR #1055). It collides with infra subdomains (api/studio/docs/www)
  // and erases the environment from the URL, which the product decision requires.
  return createParsedDomain(null, null, null, false, false);
}

/**
 * Whether the host is a hosted veryfront domain (veryfront.com / veryfront.org)
 * rather than one of the local development domains.
 *
 * The two differ in what a project-less host means. Locally it means "no project
 * chosen yet" and the project chooser answers; hosted it means the domain names
 * no project at all and nothing can answer.
 */
export function isHostedVeryfrontDomain(host: string): boolean {
  return new RegExp(`^(?:.+\\.)?(${PROD_DOMAINS})$`, "i").test(stripPort(host));
}

/**
 * Check if a domain is a valid veryfront domain (includes localhost for local dev)
 */
export function isVeryfrontDomain(host: string): boolean {
  const domain = stripPort(host);

  if (domain === "localhost") return true;

  return new RegExp(`^[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)*\\.(${ALL_DOMAINS})$`).test(domain);
}

/**
 * Check if a host is a local development host where HMR connections should be allowed.
 * Recognises localhost, 127.0.0.1, 0.0.0.0, and *.localhost — but excludes explicit
 * production/staging subdomains ({slug}.production.localhost,
 * {slug}.staging.localhost) since those are used for testing non-dev behaviour locally.
 *
 * `*.localhost` is deliberately NOT a blanket allow. It is classified by the same
 * `parseProjectDomain` rules, so `{slug}.production.localhost` and unknown namespaces
 * such as `{slug}.foobar.localhost` stay excluded. `localhost` being a single-label root
 * must not widen HMR admission relative to the two-label roots it replaced.
 *
 * `host` may carry a port; it is stripped before matching, so `app.localhost:3000`
 * is classified as `app.localhost`.
 */
export function isLocalDevHost(host: string): boolean {
  const domain = stripPort(host).toLowerCase();

  // Standard loopback / bind-all addresses
  if (domain === "localhost" || domain === "127.0.0.1" || domain === "0.0.0.0") return true;

  // Must be under the local dev root — production domains (veryfront.com/org) are not dev
  // hosts. `localhost` is a single-label root, matched here as a whole suffix.
  if (!/\.localhost$/i.test(domain)) return false;

  const parsed = parseProjectDomain(host);

  // Must be a recognized veryfront domain (rejects unknown namespaces and prod simulations)
  if (!parsed.isVeryfrontDomain) return false;

  // Explicit staging is for testing staging behaviour — not a dev host
  if (parsed.environment === "staging") return false;

  // Explicit production (`production.{local}` or `{slug}.production.{local}`) is for
  // testing production behaviour. Slug-only domains ({slug}.{local}) also parse as
  // "production" but ARE dev hosts, so exclude only the explicit forms: the bare
  // production root, and any domain carrying a ".production." label.
  if (
    parsed.environment === "production" &&
    (/^production\./i.test(domain) || /\.production\./i.test(domain))
  ) {
    return false;
  }

  return true;
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
