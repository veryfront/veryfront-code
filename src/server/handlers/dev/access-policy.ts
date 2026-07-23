import { LOCALHOST } from "#veryfront/platform/compat/constants.ts";
import type { HandlerContext } from "../types.ts";

const LOOPBACK_HOSTNAMES = new Set([
  LOCALHOST.HOSTNAME,
  LOCALHOST.IPV4,
  LOCALHOST.IPV6,
  `[${LOCALHOST.IPV6}]`,
]);

const SENSITIVE_DIRECTORY_NAMES = new Set([
  ".aws",
  ".azure",
  ".git",
  ".gnupg",
  ".kube",
  ".ssh",
]);

const SENSITIVE_FILE_NAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pnpmrc",
  ".pypirc",
  ".yarnrc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "service-account.json",
]);

const SENSITIVE_FILE_EXTENSIONS = new Set([
  "jks",
  "key",
  "keystore",
  "p12",
  "pem",
  "pfx",
]);

function parseLoopbackHttpUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    !LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())
  ) {
    return null;
  }

  return url;
}

/**
 * Require development control requests to target a loopback address. Browser
 * requests must also come from a loopback origin. Requests without an Origin
 * header remain available to local CLI and test clients.
 */
export function isAuthorizedDevControlRequest(req: Request, ctx: HandlerContext): boolean {
  if (!ctx.isLocalProject || parseLoopbackHttpUrl(req.url) === null) return false;

  const origin = req.headers.get("origin");
  if (origin === null) return true;

  const originUrl = parseLoopbackHttpUrl(origin);
  return originUrl !== null && originUrl.origin === origin;
}

/** Return whether a project-relative or canonical path may contain credentials. */
export function isSensitiveDevFilePath(path: string): boolean {
  const segments = path
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());

  if (segments.some((segment) => SENSITIVE_DIRECTORY_NAMES.has(segment))) return true;

  const fileName = segments.at(-1) ?? "";
  if (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName.endsWith(".env") ||
    SENSITIVE_FILE_NAMES.has(fileName)
  ) {
    return true;
  }

  const extension = fileName.includes(".") ? fileName.split(".").at(-1) ?? "" : "";
  return SENSITIVE_FILE_EXTENSIONS.has(extension);
}
