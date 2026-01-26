/**
 * App Route HTML Rendering for Build
 */
import type { RuntimeAdapter } from "../platform/adapters/base.js";
/**
 * Render an App Router route to HTML
 */
export declare function renderAppRouteToHTML(args: {
    adapter: RuntimeAdapter;
    projectDir: string;
    routePath: string;
    pageFile: string;
    contentSourceId: string;
}): Promise<string>;
//# sourceMappingURL=build-app-route-renderer.d.ts.map