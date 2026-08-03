const JAVASCRIPT_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/javascript; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

const UNAVAILABLE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

export const DEV_UI_ASSET_PROVIDER_MISSING_MESSAGE =
  "Development UI assets are unavailable. Install and enable @veryfront/ext-dev-ui-react.";

/** Serve one generation-captured bundle at one exact same-origin endpoint. */
export function serveDevUiBundle(
  req: Request,
  expectedPathname: string,
  browserBundle: string | undefined,
): Response | null {
  if (new URL(req.url).pathname !== expectedPathname) return null;

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...UNAVAILABLE_HEADERS, Allow: "GET, HEAD" },
    });
  }
  if (browserBundle === undefined) {
    return new Response(DEV_UI_ASSET_PROVIDER_MISSING_MESSAGE, {
      status: 503,
      headers: UNAVAILABLE_HEADERS,
    });
  }

  return new Response(req.method === "HEAD" ? null : browserBundle, {
    status: 200,
    headers: JAVASCRIPT_HEADERS,
  });
}
