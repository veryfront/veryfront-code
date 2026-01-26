/**
 * SSR HTTP Stub Stage - replaces browser-only HTTP imports with stubs during SSR.
 * Modules like video.js access browser globals at import time and fail in SSR.
 */
import type { TransformPlugin } from "../types.js";
export declare const ssrHttpStubPlugin: TransformPlugin;
//# sourceMappingURL=ssr-http-stub.d.ts.map