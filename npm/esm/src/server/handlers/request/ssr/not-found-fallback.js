import { join as joinPath } from "../../../../platform/compat/path/index.js";
import { computeContentSourceId } from "../../../../cache/keys.js";
export async function tryNotFoundFallback(req, slug, ctx, builder) {
    try {
        const appRoot = joinPath(ctx.projectDir, "app");
        try {
            const st = await ctx.adapter.fs.stat(appRoot);
            if (!st.isDirectory)
                return null;
        }
        catch {
            return null;
        }
        const searchBase = slug ? joinPath(appRoot, slug) : appRoot;
        const { collectAncestorDirs, tryLoadReservedInDirs } = await import("../../../../rendering/app-reserved.js");
        const dirs = await collectAncestorDirs(searchBase, appRoot);
        const contentSourceId = ctx.enriched?.contentSourceId ??
            computeContentSourceId(ctx.requestContext?.isLocalDev ?? false, ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview", ctx.requestContext?.branch ?? null, ctx.releaseId);
        const NotFoundComp = await tryLoadReservedInDirs(dirs, "notFound", ctx.projectDir, "production", ctx.adapter, ctx.projectId, contentSourceId);
        if (!NotFoundComp)
            return null;
        const React = await import("react");
        const { renderToStringAdapter } = await import("../../../../react/compat/ssr-adapter/index.js");
        const element = React.createElement(NotFoundComp, {});
        let inner = "";
        try {
            inner = await renderToStringAdapter(element);
        }
        catch {
            inner = (await extractNotFoundText(dirs, ctx)) ?? "<p>Not Found</p>";
        }
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>404 Not Found</title></head><body>${inner}</body></html>`;
        return builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .withCache("no-cache")
            .html(html, 404);
    }
    catch {
        return null;
    }
}
async function extractNotFoundText(dirs, ctx) {
    const candidates = [];
    for (const dir of dirs) {
        candidates.push(joinPath(dir, "not-found.tsx"), joinPath(dir, "not-found.jsx"));
    }
    for (const file of candidates) {
        try {
            const st = await ctx.adapter.fs.stat(file);
            if (!st.isFile)
                continue;
            const src = await ctx.adapter.fs.readFile(file);
            const match = src.match(/>\s*([^<]+?)\s*</);
            if (match?.[1])
                return `<p>${match[1]}</p>`;
        }
        catch {
            // try next
        }
    }
    return null;
}
