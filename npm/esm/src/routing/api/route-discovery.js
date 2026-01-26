import { relative } from "../../platform/compat/path/index.js";
import { discoverFiles } from "../../utils/file-discovery.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
const EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];
export function discoverPagesRoutes(router, dir, prefix, adapter) {
    return withSpan("api.discoverPagesRoutes", async () => {
        for await (const file of discoverFiles({
            baseDir: dir,
            extensions: EXTENSIONS,
            adapter,
        })) {
            const relativePath = relative(dir, file.path);
            const routePath = `${prefix}/${relativePath.replace(/\.(ts|js|tsx|jsx)$/, "")}`;
            const pattern = routePath.replace(/\/index$/, "") || prefix;
            router.addRoute(pattern, file.path);
        }
    }, { "api.discovery.dir": dir, "api.discovery.prefix": prefix });
}
export function discoverAppRoutes(router, dir, prefix, adapter) {
    return withSpan("api.discoverAppRoutes", async () => {
        for await (const file of discoverFiles({
            baseDir: dir,
            extensions: EXTENSIONS,
            patterns: ["route"],
            recursive: false,
            adapter,
        })) {
            if (!file.isFile || !/^route\.(ts|js|tsx|jsx)$/.test(file.name))
                continue;
            const pattern = prefix === "" ? "/" : prefix;
            router.addRoute(pattern, file.path);
        }
        for await (const entry of discoverFiles({
            baseDir: dir,
            includeDirs: true,
            recursive: false,
            adapter,
        })) {
            if (!entry.isDirectory)
                continue;
            const dirPrefix = `${prefix}/${entry.name}`;
            await discoverAppRoutes(router, entry.path, dirPrefix, adapter);
        }
    }, { "api.discovery.dir": dir, "api.discovery.prefix": prefix });
}
