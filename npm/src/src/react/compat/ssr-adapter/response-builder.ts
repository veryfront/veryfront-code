import * as dntShim from "../../../../_dnt.shims.js";
import * as React from "react";
import { getReactVersionInfo } from "../version-detector/index.js";
import { wrapInHTML } from "./html-wrapper.js";
import { renderToStreamAdapter } from "./stream-renderer.js";
import type { SSRResponseOptions } from "./types.js";

function createHtmlHeaders(baseHeaders: dntShim.HeadersInit | undefined, reactVersion: string): dntShim.Headers {
  const headers = new dntShim.Headers(baseHeaders);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-React-Version", reactVersion);
  return headers;
}

export async function createSSRResponse(
  element: React.ReactNode,
  options: SSRResponseOptions = {},
): Promise<dntShim.Response> {
  const { version } = getReactVersionInfo();
  const result = await renderToStreamAdapter(element, options);
  const headers = createHtmlHeaders(options.headers, version);

  if (result.stream) {
    return new dntShim.Response(result.stream, { status: 200, headers });
  }

  if (result.html) {
    const fullHtml = wrapInHTML(result.html, {
      title: options.title ?? "Veryfront App",
      meta: options.meta ?? {},
      links: options.links ?? [],
      scripts: options.scripts ?? [],
      bootstrapScripts: options.bootstrapScripts ?? [],
      nonce: options.nonce,
    });

    return new dntShim.Response(fullHtml, { status: 200, headers });
  }

  return new dntShim.Response("Failed to render", {
    status: 500,
    headers: { "Content-Type": "text/plain" },
  });
}
