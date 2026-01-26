import { join } from "../../platform/compat/path/index.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
import { CONFIG_DIR_NAME, TOKEN_FILE_NAME, TOKEN_FILE_PERMISSIONS } from "./constants.js";
function getConfigDir(env = getRuntimeEnv()) {
    if (env.xdgConfigHome)
        return join(env.xdgConfigHome, CONFIG_DIR_NAME);
    if (!env.homeDir)
        throw new Error("Could not determine home directory");
    return join(env.homeDir, ".config", CONFIG_DIR_NAME);
}
function getTokenPath(env = getRuntimeEnv()) {
    return join(getConfigDir(env), TOKEN_FILE_NAME);
}
export async function readToken() {
    const fs = createFileSystem();
    const tokenPath = getTokenPath();
    try {
        if (!(await fs.exists(tokenPath)))
            return null;
        const content = await fs.readTextFile(tokenPath);
        return content.trim() || null;
    }
    catch {
        return null;
    }
}
export async function saveToken(token) {
    const fs = createFileSystem();
    const configDir = getConfigDir();
    const tokenPath = getTokenPath();
    if (!(await fs.exists(configDir)))
        await fs.mkdir(configDir, { recursive: true });
    await fs.writeTextFile(tokenPath, `${token}\n`);
    await fs.chmod(tokenPath, TOKEN_FILE_PERMISSIONS);
}
export async function deleteToken() {
    const fs = createFileSystem();
    const tokenPath = getTokenPath();
    try {
        if (!(await fs.exists(tokenPath)))
            return;
        await fs.remove(tokenPath);
    }
    catch {
        // Ignore errors
    }
}
export async function hasToken() {
    return (await readToken()) !== null;
}
export function getTokenLocation() {
    return getTokenPath();
}
