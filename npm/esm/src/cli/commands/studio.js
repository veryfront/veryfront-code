/**
 * Open Veryfront Studio in browser
 * @module cli/commands/studio
 */
import { canOpenBrowser, openBrowser } from "../auth/browser.js";
import { readConfigFile } from "../shared/config.js";
import { cwd } from "../../platform/compat/process.js";
import { join } from "../../platform/compat/path/index.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { brand, dim, muted, success } from "../ui/colors.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
/**
 * Build Studio URL with optional query params
 */
export function buildStudioUrl(project, options = {}) {
    const base = `https://veryfront.com/projects/${encodeURIComponent(project)}`;
    const params = new URLSearchParams();
    if (options.branch)
        params.set("branch", options.branch);
    if (options.file)
        params.set("path", options.file);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
}
/**
 * Resolve project slug from environment, config, or directory
 */
async function resolveProjectSlug(projectDir, env = getRuntimeEnv()) {
    if (env.projectSlug)
        return env.projectSlug;
    const config = await readConfigFile(projectDir);
    if (config?.projectSlug)
        return config.projectSlug;
    const fs = createFileSystem();
    const packagePath = join(projectDir, "package.json");
    try {
        if (await fs.exists(packagePath)) {
            const content = await fs.readTextFile(packagePath);
            const pkg = JSON.parse(content);
            const name = pkg?.name;
            if (name)
                return name.replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/gi, "-");
        }
    }
    catch {
        // Ignore errors
    }
    const dirName = projectDir.split(/[/\\]/).pop();
    if (dirName)
        return dirName.replace(/[^a-z0-9-]/gi, "-");
    throw new Error("Could not determine project slug");
}
/**
 * Open Veryfront Studio in browser
 */
export async function studioCommand(options = {}, env = getRuntimeEnv()) {
    const project = options.project ?? (await resolveProjectSlug(cwd(), env));
    const url = buildStudioUrl(project, options);
    const opened = canOpenBrowser();
    console.log();
    if (opened) {
        await openBrowser(url);
        console.log("  " + success("✓") + " Opening " + brand(project) + " in Studio");
        console.log();
        console.log("  " + dim(url));
    }
    else {
        console.log("  " + muted("Open in browser:"));
        console.log();
        console.log("  " + brand(url));
    }
    console.log();
    return { url, opened };
}
