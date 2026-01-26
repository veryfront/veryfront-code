import { bundlerLogger as logger } from "../../../utils/index.js";
import { join } from "../../../platform/compat/path/index.js";
import { runtime } from "../../../platform/adapters/detect.js";
import { compileMDXFile } from "./compiler.js";
export async function watchMDX(options) {
    logger.info("Watching for MDX file changes...");
    const dirsToWatch = await getWatchableDirectories(options.projectDir);
    if (dirsToWatch.length === 0) {
        logger.warn("No MDX directories found to watch");
        return;
    }
    const { fs } = await runtime.get();
    const watcher = fs.watch(dirsToWatch, { recursive: true });
    for await (const event of watcher) {
        if (event.kind !== "modify" && event.kind !== "create")
            continue;
        await handleFileChange(event.paths, options);
    }
}
async function getWatchableDirectories(projectDir) {
    const { fs } = await runtime.get();
    const potentialDirs = ["pages", "layouts", "providers"].map((dir) => join(projectDir, dir));
    const dirsToWatch = [];
    for (const dir of potentialDirs) {
        try {
            const stat = await fs.stat(dir);
            if (stat.isDirectory)
                dirsToWatch.push(dir);
        }
        catch {
            // Directory doesn't exist, skip it
        }
    }
    return dirsToWatch;
}
async function handleFileChange(paths, options) {
    const { fs } = await runtime.get();
    for (const path of paths) {
        if (!path.endsWith(".mdx"))
            continue;
        try {
            const content = await fs.readFile(path);
            await compileMDXFile(path, content, options);
            logger.info(`Recompiled: ${path}`);
        }
        catch (error) {
            logger.error(`Failed to recompile ${path}:`, error);
        }
    }
}
