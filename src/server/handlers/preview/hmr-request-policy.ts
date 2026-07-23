import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { HandlerContext } from "../types.ts";
import { getEffectiveRequestHost } from "../../utils/request-host.ts";
import { isProxyTrusted } from "../../utils/proxy-trust.ts";
import type { HMRClientScope } from "./hmr-client-manager.ts";

const HMR_PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
} as const;
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "cross-site", "none"]);

export interface AuthorizedHmrRequest {
  isLocalProject: boolean;
  proxyTrusted: boolean;
  scope: HMRClientScope;
  url: URL;
}

export function privateHmrResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(HMR_PRIVATE_RESPONSE_HEADERS);
  headers.set("content-type", "text/plain; charset=utf-8");
  for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  return new Response(body, { ...init, headers });
}

function parseForwardedProtocol(req: Request, proxyTrusted: boolean, url: URL): string | null {
  if (!proxyTrusted) {
    return url.protocol === "http:" || url.protocol === "https:" ? url.protocol : null;
  }
  const raw = req.headers.get("x-forwarded-proto");
  if (!raw) return url.protocol === "http:" || url.protocol === "https:" ? url.protocol : null;
  const protocol = raw.split(",")[0]?.trim().toLowerCase();
  return protocol === "http" || protocol === "https" ? `${protocol}:` : null;
}

function getPublicOrigin(req: Request, url: URL, proxyTrusted: boolean): string | null {
  const protocol = parseForwardedProtocol(req, proxyTrusted, url);
  const host = getEffectiveRequestHost(req, url, proxyTrusted).trim();
  if (!protocol || !host || /[\s/@\\?#,]/.test(host)) return null;
  try {
    const publicUrl = new URL(`${protocol}//${host}`);
    if (publicUrl.username || publicUrl.password || publicUrl.pathname !== "/") return null;
    return publicUrl.origin;
  } catch {
    return null;
  }
}

function parseHttpOrigin(value: string): string | null {
  try {
    const origin = new URL(value);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") || origin.username ||
      origin.password || origin.pathname !== "/" || origin.search || origin.hash
    ) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

export function isAuthorizedHmrOrigin(
  req: Request,
  authorization: AuthorizedHmrRequest,
): boolean {
  const fetchSite = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && (!ALLOWED_FETCH_SITES.has(fetchSite) || fetchSite === "cross-site")) {
    return false;
  }
  const publicOrigin = getPublicOrigin(req, authorization.url, authorization.proxyTrusted);
  if (!publicOrigin) return false;
  const originHeader = req.headers.get("origin");
  if (originHeader === null) return authorization.isLocalProject;
  return parseHttpOrigin(originHeader) === publicOrigin;
}

function getClientScope(ctx: HandlerContext): HMRClientScope {
  if (ctx.isLocalProject && ctx.projectDir) return { projectDir: ctx.projectDir };
  return {
    projectSlug: ctx.projectSlug,
    projectId: ctx.projectId,
    environment: ctx.resolvedEnvironment,
    branch: ctx.requestContext?.branch,
  };
}

function hasProjectIdentity(scope: HMRClientScope, isLocalProject: boolean): boolean {
  if (isLocalProject) return !!(scope.projectId || scope.projectSlug || scope.projectDir);
  return !!(scope.projectId || scope.projectSlug);
}

export async function authorizeHmrRequest(
  req: Request,
  ctx: HandlerContext,
): Promise<AuthorizedHmrRequest | null> {
  const url = new URL(req.url);
  const scope = getClientScope(ctx);
  const isLocalProject = ctx.isLocalProject === true;
  const proxyTrusted = await isProxyTrusted(req, {
    publicKeyPem: getHostEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY"),
  });
  const hasConsistentPreviewMode = ctx.requestContext?.mode === "preview" &&
    ctx.resolvedEnvironment !== "production";
  const isTrustedRemotePreview = !isLocalProject && proxyTrusted && hasConsistentPreviewMode;
  if (
    (!isLocalProject && !isTrustedRemotePreview) ||
    !hasProjectIdentity(scope, isLocalProject)
  ) return null;
  return { isLocalProject, proxyTrusted, scope, url };
}
