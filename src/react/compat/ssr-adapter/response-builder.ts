import * as React from "react";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { renderToStreamAdapter } from "./stream-renderer.ts";
import { wrapInHTML } from "./html-wrapper.ts";
import type { SSRResponseOptions } from "./types.ts";

export async function createSSRResponse(
  element: React.ReactNode,
  options: SSRResponseOptions = {},
): Promise<Response> {
  const versionInfo = getReactVersionInfo();

  const result = await renderToStreamAdapter(element, options);

  if (result.stream) {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-React-Version", versionInfo.version);

    return new Response(result.stream, {
      status: 200,
      headers,
    });
  }

  if (result.html) {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-React-Version", versionInfo.version);

    const fullHtml = wrapInHTML(result.html, {
      title: options.title || "Veryfront App",
      meta: options.meta || {},
      links: options.links || [],
      scripts: options.scripts || [],
      bootstrapScripts: options.bootstrapScripts || [],
      nonce: options.nonce,
    });

    return new Response(fullHtml, {
      status: 200,
      headers,
    });
  }

  return new Response("Failed to render", {
    status: 500,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}
