import { type TokenScope } from "./token-manager.ts";

export const INTERNAL_PROXY_HEADERS = [
  "x-token",
  "x-project-slug",
  "x-environment",
  "x-environment-id",
  "x-content-source-id",
  "x-forwarded-host",
  "x-project-path",
  "x-project-id",
  "x-release-id",
  "x-branch-id",
  "x-branch-name",
] as const;

const INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS = [
  "x-veryfront-control-plane-jws",
  "x-veryfront-dispatch-jws",
] as const;

export function isInternalControlPlanePath(pathname: string): boolean {
  return pathname === "/channels/invoke" ||
    pathname.startsWith("/internal/agents/") ||
    pathname.startsWith("/internal/tasks/") ||
    pathname.startsWith("/internal/workflows/");
}

export function isSignedInternalControlPlaneRequest(req: Request): boolean {
  const pathname = new URL(req.url).pathname;
  if (!isInternalControlPlanePath(pathname)) {
    return false;
  }

  const hasSignature = INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS.some((header) =>
    !!req.headers.get(header)
  );
  if (!hasSignature) {
    return false;
  }

  return !!req.headers.get("x-token");
}

export function getRequestHost(req: Request): string {
  return req.headers.get("host") ?? new URL(req.url).host;
}

export function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

export function extractUserToken(cookieHeader: string): string | undefined {
  const match = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
