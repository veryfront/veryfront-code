import { isAbsolute, join } from "../../platform/compat/path/index.js";
import { cwd } from "../../platform/compat/process.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "../../utils/index.js";
import { devCommand } from "../commands/dev.js";
async function resolveProjectDir(args) {
    const projectArg = args.project ? String(args.project) : undefined;
    if (projectArg) {
        const resolved = isAbsolute(projectArg) ? projectArg : join(cwd(), projectArg);
        cliLogger.debug("Using project directory from --project flag", { projectDir: resolved });
        return resolved;
    }
    const projectDir = cwd();
    const fs = createFileSystem();
    const configPaths = [
        join(projectDir, "veryfront.config.ts"),
        join(projectDir, "veryfront.config.js"),
    ];
    for (const configPath of configPaths) {
        if (await fs.exists(configPath))
            return projectDir;
    }
    cliLogger.debug("No veryfront config found, using defaults");
    return projectDir;
}
export async function handleDevCommand(args) {
    const projectDir = await resolveProjectDir(args);
    const port = typeof args.port === "number" ? args.port : DEFAULT_DEV_SERVER_PORT;
    await devCommand({
        port,
        projectDir,
        hmr: args.hmr !== false,
    });
}
