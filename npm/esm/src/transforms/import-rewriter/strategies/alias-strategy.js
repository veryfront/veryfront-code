/**
 * Path alias (@/) import rewriting strategy.
 *
 * Priority: 1
 * Handles: @/components/Button, @/utils/helpers
 */
import { normalizeExtension } from "../url-builder.js";
export class AliasStrategy {
    name = "alias";
    priority = 1;
    matches(specifier, _ctx) {
        return specifier.startsWith("@/");
    }
    rewrite(info, ctx) {
        const path = info.specifier.slice(2); // Remove "@/"
        // Calculate relative path from file to project root
        const relativeFilePath = this.getRelativeFilePath(ctx.filePath, ctx.projectDir);
        const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
        const depth = fileDir.split("/").filter(Boolean).length;
        const relativeToRoot = depth === 0 ? "." : "../".repeat(depth).slice(0, -1);
        // Build the relative path
        let relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;
        // Handle extension
        if (!/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(relativePath)) {
            relativePath = `${relativePath}.js`;
        }
        else if (ctx.target === "ssr") {
            relativePath = normalizeExtension(relativePath);
        }
        return { specifier: relativePath };
    }
    getRelativeFilePath(filePath, projectDir) {
        const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
        if (filePath.startsWith(normalizedProjectDir)) {
            return filePath.substring(normalizedProjectDir.length + 1);
        }
        if (!filePath.startsWith("/"))
            return filePath;
        const pathParts = filePath.split("/");
        const projectParts = normalizedProjectDir.split("/");
        const lastProjectPart = projectParts[projectParts.length - 1];
        const projectIndex = lastProjectPart ? pathParts.indexOf(lastProjectPart) : -1;
        if (projectIndex >= 0) {
            return pathParts.slice(projectIndex + 1).join("/");
        }
        return filePath;
    }
}
export const aliasStrategy = new AliasStrategy();
