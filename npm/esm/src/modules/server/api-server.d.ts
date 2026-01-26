import * as dntShim from "../../../_dnt.shims.js";
export interface PageRenderResult {
    html: string;
    frontmatter: Record<string, unknown>;
    headings?: Array<{
        depth: number;
        text: string;
        id?: string;
    }>;
}
export interface PageRendererLike {
    renderPage: (slug: string) => Promise<PageRenderResult>;
}
export interface APIServerOptions {
    renderer: PageRendererLike;
}
export declare class APIServer {
    private options;
    constructor(options: APIServerOptions);
    handleRequest(pathname: string): Promise<dntShim.Response | null>;
}
//# sourceMappingURL=api-server.d.ts.map