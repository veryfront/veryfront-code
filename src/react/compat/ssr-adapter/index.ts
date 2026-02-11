/**
 * Compat - Ssr Adapter
 *
 * @module react/compat/ssr-adapter
 */

export type { HTMLWrapOptions, SSROptions, SSRResponseOptions, SSRResult } from "./types.ts";
export { getProjectReact, getReactDOMServer } from "./server-loader.ts";
export type { ReactDOMServer } from "./server-loader.ts";
export { renderToStaticMarkupAdapter, renderToStringAdapter } from "./string-renderer.ts";
export { renderToStreamAdapter } from "./stream-renderer.ts";
export { wrapInHTML } from "./html-wrapper.ts";
export { createSSRResponse } from "./response-builder.ts";
