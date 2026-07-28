import { serverLogger as logger } from "#veryfront/utils";
import { parseDataEndpointPath } from "./data-endpoint-path.ts";

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
    let slug: string;
    try {
      const parsed = parseDataEndpointPath(pathname);
      if (!parsed.matched) return null;
      slug = parsed.slug;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid data request path" }), {
        status: 400,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-cache",
        },
      });
    }
    const pageSlug = slug || "index";

    try {
      const result = await this.options.renderer.renderPage(pageSlug);

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
}
