import * as dntShim from "../../../../../_dnt.shims.js";
import { BaseHandler } from "../../response/base.js";
import { validateDevFilePath } from "./path-validator.js";
import { bundleDevFile } from "./esbuild-bundler.js";
import { HTTP_INTERNAL_SERVER_ERROR, HTTP_NOT_FOUND, PRIORITY_MEDIUM_DEV_FILES, } from "../../../../utils/constants/index.js";
export class DevFileHandler extends BaseHandler {
    metadata = {
        name: "DevFileHandler",
        priority: PRIORITY_MEDIUM_DEV_FILES,
        patterns: [{ pattern: "/_veryfront/fs/", prefix: true, method: "GET" }],
        enabled: (ctx) => ctx.requestContext?.isLocalDev ?? false,
    };
    async handle(req, ctx) {
        const { pathname } = new URL(req.url);
        if (req.method !== "GET" || !pathname.startsWith("/_veryfront/fs/")) {
            return this.continue();
        }
        const encoded = pathname.slice("/_veryfront/fs/".length).replace(/\.js$/, "");
        const absPath = await validateDevFilePath(encoded, ctx);
        if (absPath.startsWith("Error:")) {
            const message = absPath.slice("Error: ".length);
            this.logDebug("dev fs validation failed", { message }, ctx);
            return this.respond(this.createErrorModule(message, HTTP_NOT_FOUND));
        }
        try {
            const code = await bundleDevFile(absPath, ctx);
            const response = this.createResponseBuilder(ctx)
                .withCORS(req, ctx.securityConfig?.cors)
                .withSecurity(ctx.securityConfig ?? undefined)
                .withCache("no-cache")
                .javascript(code);
            return this.respond(response);
        }
        catch (error) {
            const reason = this.getErrorMessage(error);
            this.logDebug("esbuild failed for dev fs", { path: absPath, reason }, ctx);
            return this.respond(this.createErrorModule(`Build error: ${reason}`, HTTP_INTERNAL_SERVER_ERROR));
        }
    }
    createErrorModule(message, status) {
        return new dntShim.Response(`export default null; // ${message}`, {
            status,
            headers: { "content-type": "application/javascript" },
        });
    }
}
