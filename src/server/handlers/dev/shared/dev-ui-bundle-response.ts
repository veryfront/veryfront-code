import { cancelRejectedLocalControlRequestBody } from "#veryfront/security/http/local-control-request.ts";

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

export function createDevUiAssetsUnavailableResponse(): Response {
  return new Response(DEV_UI_ASSET_PROVIDER_MISSING_MESSAGE, {
    status: 503,
    headers: UNAVAILABLE_HEADERS,
  });
}

/** Preserve GET status and headers while enforcing the HTTP HEAD body contract. */
export function omitHeadResponseBody(req: Request, response: Response): Response {
  return req.method === "HEAD"
    ? new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
    : response;
}

/**
 * Serve one generation-captured bundle at one exact endpoint path. Origin and
 * host admission are enforced by the callers that gate the dev UI surfaces.
 */
export function serveDevUiBundle(
  req: Request,
  expectedPathname: string,
  browserBundle: string | undefined,
): Response | null {
  if (new URL(req.url).pathname !== expectedPathname) return null;

  if (req.method !== "GET" && req.method !== "HEAD") {
    cancelRejectedLocalControlRequestBody(req, "Dev UI bundle method rejected");
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...UNAVAILABLE_HEADERS, Allow: "GET, HEAD" },
    });
  }
  if (browserBundle === undefined) {
    return omitHeadResponseBody(
      req,
      createDevUiAssetsUnavailableResponse(),
    );
  }

  return omitHeadResponseBody(
    req,
    new Response(browserBundle, {
      status: 200,
      headers: JAVASCRIPT_HEADERS,
    }),
  );
}
