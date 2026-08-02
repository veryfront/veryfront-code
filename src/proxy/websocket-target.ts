import { normalizeProxyOriginFormPath } from "./request-path.ts";
import { hasProjectIdentityControlCharacters } from "#veryfront/utils/project-identity.ts";

/**
 * Build the renderer WebSocket target without permitting protocol-relative
 * paths or authority changes from the incoming request.
 */
export function createProxyWebSocketTargetUrl(
  serverOrigin: string,
  requestUrl: URL,
  projectSlug: string,
  environment: string,
): string {
  if (
    typeof serverOrigin !== "string" ||
    serverOrigin === "" ||
    serverOrigin !== serverOrigin.trim() ||
    serverOrigin.includes("\\") ||
    hasProjectIdentityControlCharacters(serverOrigin)
  ) {
    throw new TypeError("Proxy WebSocket server origin is invalid");
  }
  let base: URL;
  try {
    base = new URL(serverOrigin);
  } catch {
    throw new TypeError("Proxy WebSocket server origin is invalid");
  }
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    !base.hostname ||
    base.username !== "" ||
    base.password !== "" ||
    base.pathname !== "/" ||
    base.search !== "" ||
    base.hash !== ""
  ) {
    throw new TypeError(
      "Proxy WebSocket server origin must be a credential-free HTTP(S) URL without a path, query, or fragment",
    );
  }
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";

  const target = new URL(base);
  target.pathname = normalizeProxyOriginFormPath(requestUrl.pathname);
  target.search = requestUrl.search;
  target.searchParams.set("x-project-slug", projectSlug);
  target.searchParams.set("x-environment", environment);
  return target.toString();
}
