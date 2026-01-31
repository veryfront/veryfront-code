import type * as React from "react";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { wrapInHTML } from "./html-wrapper.ts";
import { renderToStreamAdapter } from "./stream-renderer.ts";
import type { SSRResponseOptions } from "./types.ts";

function createHtmlHeaders(baseHeaders: HeadersInit | undefined, reactVersion: string): Headers {
  const headers = new Headers(baseHeaders);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-React-Version", reactVersion);
  return headers;
}

export async function createSSRResponse(
  element: React.ReactNode,
  options: SSRResponseOptions = {},
): Promise<Response> {
  const { version } = getReactVersionInfo();
  const result = await renderToStreamAdapter(element, options);
  const headers = createHtmlHeaders(options.headers, version);

  if (result.stream) {
    return new Response(result.stream, { status: 200, headers });
  }

  if (!result.html) {
    return new Response("Failed to render", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const fullHtml = wrapInHTML(result.html, {
    title: options.title ?? "Veryfront App",
    meta: options.meta ?? {},
    links: options.links ?? [],
    scripts: options.scripts ?? [],
    bootstrapScripts: options.bootstrapScripts ?? [],
    nonce: options.nonce,
  });

  return new Response(fullHtml, { status: 200, headers });
}
