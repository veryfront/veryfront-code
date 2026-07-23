import type { ProxyContext, ProxyParsedDomain } from "./handler.ts";

/** Stable proxy error slugs with dedicated public handling. */
export type ProxyErrorSlug =
  | "authentication-failed"
  | "project-not-found"
  | "release-not-found";

/** Routing fields preserved when constructing an error context. */
export interface ProxyErrorContextBase {
  /** Runtime token scope. */
  scope: "preview" | "production";
  /** Normalized request host. */
  host: string;
  /** Parsed request-domain classification. */
  parsedDomain: ProxyParsedDomain;
}

/** Error-specific fields used to construct a proxy context. */
export interface ProxyErrorContextOptions {
  /** HTTP response status. */
  status: number;
  /** Public error message. */
  message: string;
  /** Token retained for downstream diagnostics that never run on an error response. */
  token?: string;
  /** Approved sign-in redirect URL. */
  redirectUrl?: string;
  /** Stable error-page discriminator. */
  slug?: ProxyErrorSlug;
}

/** Construct a fully shaped proxy context that carries a public error. */
export function createProxyErrorContext(
  base: ProxyErrorContextBase,
  options: ProxyErrorContextOptions,
): ProxyContext {
  return {
    token: options.token,
    projectSlug: undefined,
    projectId: undefined,
    environment: base.scope,
    contentSourceId: "error",
    localPath: undefined,
    host: base.host,
    parsedDomain: base.parsedDomain,
    isLocalProject: false,
    error: {
      status: options.status,
      message: options.message,
      redirectUrl: options.redirectUrl,
      slug: options.slug,
    },
  };
}

/** Construct the standardized project-not-found proxy context. */
export function createProjectNotFoundProxyContext(
  base: ProxyErrorContextBase,
  message: "Preview project not found" | "Project not found",
  token?: string,
): ProxyContext {
  return createProxyErrorContext(base, {
    status: 404,
    message,
    token,
    slug: "project-not-found",
  });
}

/** Construct the standardized active-release-not-found proxy context. */
export function createReleaseNotFoundProxyContext(
  base: ProxyErrorContextBase,
  token?: string,
): ProxyContext {
  return createProxyErrorContext(base, {
    status: 404,
    message: "No active release found",
    token,
    slug: "release-not-found",
  });
}
