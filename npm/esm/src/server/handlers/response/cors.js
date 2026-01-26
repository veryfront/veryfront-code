import { BaseHandler } from "./base.js";
import { ResponseBuilder } from "../../../security/index.js";
import { joinPath } from "../../../utils/path-utils.js";
import { getConfig } from "../../../config/index.js";
import { PRIORITY_VERY_HIGH } from "../../../utils/constants/index.js";
export class CorsHandler extends BaseHandler {
    metadata = {
        name: "CorsHandler",
        priority: PRIORITY_VERY_HIGH,
        patterns: [{ pattern: /.*/, method: "OPTIONS" }],
    };
    async handle(req, ctx) {
        if (req.method.toUpperCase() !== "OPTIONS")
            return this.continue();
        const pathname = new URL(req.url).pathname;
        const allowMethods = await this.resolveAllowedMethods(pathname, ctx);
        let corsConfig = ctx.securityConfig?.cors;
        try {
            const cfg = await getConfig(ctx.projectDir, ctx.adapter);
            corsConfig = cfg?.security?.cors ?? corsConfig;
        }
        catch (error) {
            this.logDebug("Failed to load CORS config", { error: error }, ctx);
        }
        const response = ResponseBuilder.preflight(req, {
            allowMethods,
            allowHeaders: req.headers.get("access-control-request-headers") ??
                "Content-Type,Authorization",
            securityConfig: ctx.securityConfig ?? undefined,
            corsConfig,
        });
        return this.respond(response);
    }
    static DEFAULT_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
    static HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    static ROUTE_FILE_NAMES = [
        "route.tsx",
        "route.ts",
        "route.jsx",
        "route.js",
    ];
    async resolveAllowedMethods(pathname, ctx) {
        try {
            const match = await this.resolveAppRouteFile(pathname, ctx);
            if (!match)
                return CorsHandler.DEFAULT_METHODS;
            const mod = (await import(`file://${match.file}`));
            const foundMethods = CorsHandler.HTTP_METHODS.filter((m) => typeof mod[m] === "function");
            const methods = [...foundMethods];
            if (foundMethods.includes("GET"))
                methods.unshift("HEAD");
            methods.push("OPTIONS");
            return [...new Set(methods)].join(", ");
        }
        catch (error) {
            this.logDebug("Failed to resolve route for CORS", { error: error, pathname }, ctx);
            return CorsHandler.DEFAULT_METHODS;
        }
    }
    async resolveAppRouteFile(path, ctx) {
        const appRoot = joinPath(ctx.projectDir, "app");
        try {
            const st = await ctx.adapter.fs.stat(appRoot);
            if (!st.isDirectory)
                return null;
        }
        catch (error) {
            this.logDebug("App directory not found", { appRoot, error: error }, ctx);
            return null;
        }
        const normalized = path === "/" ? "/" : path.replace(/\/$/, "");
        const segments = normalized.split("/").filter(Boolean);
        let current = appRoot;
        const params = {};
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const names = [];
            try {
                for await (const e of ctx.adapter.fs.readDir(current)) {
                    if (e.isDirectory)
                        names.push(e.name);
                }
            }
            catch {
                return null;
            }
            if (names.includes(seg)) {
                current = joinPath(current, seg);
                continue;
            }
            const dyn = names.find((n) => /^\[[^\]]+\]$/.test(n));
            if (dyn) {
                params[dyn.slice(1, -1)] = seg;
                current = joinPath(current, dyn);
                continue;
            }
            const ca = names.find((n) => /^\[\.\.\.[^\]]+\]$/.test(n));
            if (ca) {
                params[ca.slice(4, -1)] = segments.slice(i).join("/");
                current = joinPath(current, ca);
                break;
            }
            const opt = names.find((n) => /^\[\[\.\.\.[^\]]+\]\]$/.test(n));
            if (opt) {
                params[opt.slice(5, -2)] = segments.slice(i).join("/");
                current = joinPath(current, opt);
                break;
            }
            return null;
        }
        for (const name of CorsHandler.ROUTE_FILE_NAMES) {
            const filePath = joinPath(current, name);
            try {
                const st = await ctx.adapter.fs.stat(filePath);
                if (st.isFile)
                    return { file: filePath, params };
            }
            catch {
                // ignore
            }
        }
        return null;
    }
}
