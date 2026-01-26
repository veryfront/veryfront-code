import * as dntShim from "../../../_dnt.shims.js";
import { serverLogger as logger } from "../../utils/index.js";
export class APIServer {
    options;
    constructor(options) {
        this.options = options;
    }
    async handleRequest(pathname) {
        if (!pathname.startsWith("/_veryfront/data/"))
            return null;
        const slug = pathname.replace("/_veryfront/data/", "").replace(".json", "");
        try {
            const result = await this.options.renderer.renderPage(slug || "index");
            return new dntShim.Response(JSON.stringify({
                slug,
                frontmatter: result.frontmatter,
                headings: result.headings,
                html: result.html,
            }), {
                headers: {
                    "content-type": "application/json",
                    "cache-control": "no-cache",
                },
            });
        }
        catch (error) {
            logger.error(`Error rendering page data for ${slug}:`, error);
            return new dntShim.Response(JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
            }), {
                status: 404,
                headers: { "content-type": "application/json" },
            });
        }
    }
}
