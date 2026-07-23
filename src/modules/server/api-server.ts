import { serverLogger as logger } from "#veryfront/utils";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const DATA_PATH_PREFIX = "/_veryfront/data/";
const MAX_DATA_SLUG_LENGTH = 2_048;
const MAX_PAGE_DATA_BYTES = 10 * 1024 * 1024;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

function parseDataSlug(pathname: string): string | null {
  const encodedSlug = pathname.slice(DATA_PATH_PREFIX.length);
  if (!encodedSlug.endsWith(".json") || /%2f|%5c/i.test(encodedSlug)) return null;

  let slug: string;
  try {
    slug = decodeURIComponent(encodedSlug.slice(0, -".json".length));
  } catch {
    return null;
  }
  if (
    slug.length > MAX_DATA_SLUG_LENGTH || slug.includes("\\") || slug.includes("%") ||
    hasUnsafeControlCharacters(slug) ||
    slug.split("/").some((segment) => segment === "." || segment === ".." || segment === "")
  ) {
    return slug === "" ? "" : null;
  }
  return slug;
}

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
    if (!pathname.startsWith(DATA_PATH_PREFIX)) return null;

    const slug = parseDataSlug(pathname);
    if (slug === null) return jsonError(400, "Invalid page data path");
    const pageSlug = slug || "index";

    let result: PageRenderResult;
    try {
      result = await this.options.renderer.renderPage(pageSlug);
    } catch (error) {
      logger.error("Page data rendering failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return jsonError(404, "Page not found");
    }

    try {
      if (
        typeof result.html !== "string" ||
        typeof result.frontmatter !== "object" ||
        result.frontmatter === null ||
        Array.isArray(result.frontmatter)
      ) {
        throw new TypeError("Invalid page render result");
      }
      const body = JSON.stringify({
        slug,
        frontmatter: result.frontmatter,
        headings: result.headings,
        html: result.html,
      });
      if (new TextEncoder().encode(body).byteLength > MAX_PAGE_DATA_BYTES) {
        throw new RangeError("Page data exceeds the supported size");
      }
      return new Response(body, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    } catch (error) {
      logger.error("Page data serialization failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return jsonError(500, "Page data serialization failed");
    }
  }
}
