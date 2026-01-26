import * as dntShim from "../../../../../_dnt.shims.js";
import { BaseHandler } from "../../response/base.js";
import { HTTP_OK, PRIORITY_HIGH } from "../../../../utils/constants/index.js";
import { PROJECTS_SHELL_HTML } from "./html-shell.js";
import { handleProjectsAPI } from "./api.js";
import { handleProjectsUI } from "./ui-handler.js";
export class ProjectsHandler extends BaseHandler {
    metadata = {
        name: "ProjectsHandler",
        priority: PRIORITY_HIGH,
        patterns: [
            { pattern: "/", exact: true },
            { pattern: "/_projects", exact: false },
        ],
        enabled: (ctx) => {
            const isVeryfrontDomain = ctx.parsedDomain?.isVeryfrontDomain === true;
            const hasNoSlug = !ctx.projectSlug;
            // Enable for veryfront domains without a project slug
            // Works in both proxy mode and local multi-project mode
            return isVeryfrontDomain && hasNoSlug;
        },
    };
    shouldHandle(req, ctx) {
        if (!this.metadata.enabled?.(ctx))
            return false;
        const { pathname } = new URL(req.url);
        return pathname === "/" || pathname.startsWith("/_projects");
    }
    async handle(req, ctx) {
        if (!this.shouldHandle(req, ctx))
            return this.continue();
        const { pathname } = new URL(req.url);
        if (pathname === "/" || pathname === "/_projects" || pathname === "/_projects/") {
            return this.respond(this.createResponseBuilder(ctx).withCache("no-cache").withContentType("text/html; charset=utf-8", PROJECTS_SHELL_HTML, HTTP_OK));
        }
        if (pathname.startsWith("/_projects/ui/")) {
            const response = await handleProjectsUI(req);
            return response ? this.respond(response) : this.notFound();
        }
        if (pathname.startsWith("/_projects/api/")) {
            const response = await handleProjectsAPI(req, ctx);
            return response ? this.respond(response) : this.notFound();
        }
        return this.notFound();
    }
    notFound() {
        return this.respond(new dntShim.Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        }));
    }
}
