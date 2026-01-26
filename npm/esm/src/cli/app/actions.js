/**
 * CLI App Actions
 *
 * Handlers for opening projects in browser, Studio, and IDE.
 * Uses cross-runtime platform abstractions for filesystem and command execution.
 */
import { openBrowser } from "../auth/browser.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { getOsType, runCommand } from "../../platform/compat/process.js";
import { join } from "../../platform/compat/path/index.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
/** IDE command-line executables */
const IDE_COMMANDS = {
    cursor: "cursor",
    code: "code",
    zed: "zed",
    idea: "idea",
    webstorm: "webstorm",
};
/** IDE display names */
const IDE_NAMES = {
    cursor: "Cursor",
    code: "VS Code",
    zed: "Zed",
    idea: "IntelliJ IDEA",
    webstorm: "WebStorm",
};
/** IDE detection order (preferred first) */
const IDE_DETECTION_ORDER = ["cursor", "code", "zed", "idea", "webstorm"];
/** Cache directories to clear relative to project path */
const PROJECT_CACHE_DIRS = [".cache", "node_modules/.cache"];
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
async function commandExists(cmd) {
    try {
        const whichCmd = getOsType() === "windows" ? "where" : "which";
        const result = await runCommand(whichCmd, { args: [cmd] });
        return result.success;
    }
    catch {
        return false;
    }
}
async function runCommandLocal(cmd, args) {
    try {
        const result = await runCommand(cmd, { args });
        return result.success;
    }
    catch {
        return false;
    }
}
export async function openInBrowser(project, port) {
    const url = `http://${project.slug}.veryfront.me:${port}`;
    try {
        await openBrowser(url);
        return { success: true, message: `Opened ${url}` };
    }
    catch (error) {
        return { success: false, message: `Failed to open browser: ${formatError(error)}` };
    }
}
export async function openInStudio(project) {
    const url = `https://veryfront.com/projects/${project.slug}`;
    try {
        await openBrowser(url);
        return { success: true, message: `Opened Studio for ${project.slug}` };
    }
    catch (error) {
        return { success: false, message: `Failed to open Studio: ${formatError(error)}` };
    }
}
export async function detectIDEs() {
    const available = [];
    for (const ide of IDE_DETECTION_ORDER) {
        if (await commandExists(IDE_COMMANDS[ide])) {
            available.push(ide);
        }
    }
    return available;
}
export async function getPreferredIDE() {
    const ides = await detectIDEs();
    return ides[0] ?? null;
}
async function openPathInIDE(path, ide) {
    const targetIDE = ide ?? (await getPreferredIDE());
    if (!targetIDE) {
        return {
            success: false,
            message: "No supported IDE found. Install VS Code, Cursor, or Zed.",
        };
    }
    const cmd = IDE_COMMANDS[targetIDE];
    const name = IDE_NAMES[targetIDE];
    if (await runCommandLocal(cmd, [path])) {
        return { success: true, message: `Opened in ${name}` };
    }
    return { success: false, message: `Failed to open ${name}` };
}
export async function openInIDE(project, ide) {
    const result = await openPathInIDE(project.path, ide);
    if (!result.success)
        return result;
    const ideName = result.message?.split(" in ")[1];
    return { success: true, message: `Opened ${project.slug} in ${ideName}` };
}
export function openFileInIDE(filePath, ide) {
    return openPathInIDE(filePath, ide);
}
export async function clearProjectCache(project) {
    const fs = createFileSystem();
    let cleared = 0;
    for (const relativeDir of PROJECT_CACHE_DIRS) {
        const dir = join(project.path, relativeDir);
        try {
            await fs.remove(dir, { recursive: true });
            cleared++;
        }
        catch {
            // Directory doesn't exist
        }
    }
    const message = cleared > 0 ? `Cleared ${cleared} cache directories` : "No caches to clear";
    return { success: true, message };
}
export async function openMCPSettings(env = getRuntimeEnv()) {
    const home = env.homeDir || "";
    const claudeDir = join(home, ".claude");
    const settingsPath = join(claudeDir, "settings.json");
    const fs = createFileSystem();
    try {
        await fs.mkdir(claudeDir, { recursive: true });
    }
    catch {
        // Already exists
    }
    if (!(await fs.exists(settingsPath))) {
        const defaultSettings = { mcpServers: {} };
        await fs.writeTextFile(settingsPath, JSON.stringify(defaultSettings, null, 2));
    }
    return openFileInIDE(settingsPath);
}
export function quickOpen(projects, num, port) {
    const index = num - 1;
    if (index < 0 || index >= projects.length) {
        return Promise.resolve({ success: false, message: `No project at position ${num}` });
    }
    const project = projects[index];
    return openInBrowser({ slug: project.slug, path: project.path, type: "local" }, port);
}
