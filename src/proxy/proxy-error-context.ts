import type { ParsedDomain } from "#veryfront/server/utils/domain-parser.ts";
import type { TokenScope } from "./token-manager.ts";
import type { ProxyContext } from "./handler.ts";

export type ProxyErrorSlug =
  | "authentication-failed"
  | "project-not-found"
  | "release-not-found";

export interface ProxyErrorContextBase {
  scope: TokenScope;
  host: string;
  parsedDomain: ParsedDomain;
}

export interface ProxyErrorContextOptions {
  status: number;
  message: string;
  token?: string;
  redirectUrl?: string;
  slug?: ProxyErrorSlug;
}

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
