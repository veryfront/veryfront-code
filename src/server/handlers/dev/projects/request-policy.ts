import { LOCALHOST } from "#veryfront/platform/compat/constants.ts";

const PROJECTS_DEV_HOSTNAMES = new Set([
  LOCALHOST.HOSTNAME,
  LOCALHOST.IPV4,
  LOCALHOST.IPV6,
  `[${LOCALHOST.IPV6}]`,
  "lvh.me",
  "veryfront.dev",
  "veryfront.me",
]);

export const PROJECTS_PRIVATE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Expires": "0",
  "X-Content-Type-Options": "nosniff",
});

function parseProjectsDevUrl(value: string): URL | null {
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
    !PROJECTS_DEV_HOSTNAMES.has(url.hostname.toLowerCase())
  ) {
    return null;
  }

  return url;
}

/** Require project-picker requests to use an approved local host and exact browser origin. */
export function isAuthorizedProjectsRequest(req: Request): boolean {
  const target = parseProjectsDevUrl(req.url);
  if (!target) return false;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = req.headers.get("origin");
  if (origin === null) return true;

  const originUrl = parseProjectsDevUrl(origin);
  return originUrl !== null && origin === target.origin && originUrl.origin === target.origin;
}

/** Add private caching and MIME-sniffing headers to a project-picker response. */
export function withPrivateProjectsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(PROJECTS_PRIVATE_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createPrivateProjectsResponse(
  body: BodyInit | null,
  status: number,
  headers: HeadersInit = {},
): Response {
  return withPrivateProjectsHeaders(new Response(body, { status, headers }));
}
