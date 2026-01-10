import { serverLogger as logger } from "@veryfront/utils";

export interface PageRenderResult {
  html: string;
  frontmatter: Record<string, unknown>;
  headings?: Array<{ depth: number; text: string; id?: string }>;
}

export interface PageRendererLike {
  renderPage: (slug: string) => Promise<PageRenderResult>;
}

export interface APIServerOptions {
  renderer: PageRendererLike;
}

export class APIServer {
  constructor(private options: APIServerOptions) {}

  async handleRequest(pathname: string): Promise<Response | null> {
    // Handle page data API (for client-side navigation)
    if (pathname.startsWith("/_veryfront/data/")) {
      const slug = pathname.replace("/_veryfront/data/", "").replace(".json", "");

      try {
        const result = await this.options.renderer.renderPage(slug || "index");

        return new Response(
          JSON.stringify({
            slug,
            frontmatter: result.frontmatter,
            headings: result.headings,
            html: result.html,
          }),
          {
            headers: {
              "content-type": "application/json",
              "cache-control": "no-cache",
            },
          },
        );
      } catch (error) {
        logger.error(`Error rendering page data for ${slug}:`, error);

        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          },
        );
      }
    }

    // User-defined API routes starting with /api/ are handled by APIRouteHandler
    return null;
  }
}
