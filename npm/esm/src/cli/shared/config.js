/**
 * Shared CLI configuration for pull/push commands
 *
 * Handles API URL, authentication tokens, and project resolution.
 * @module cli/shared/config
 */
import * as dntShim from "../../../_dnt.shims.js";
import { join } from "../../platform/compat/path/index.js";
import { cwd } from "../../platform/compat/process.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
import { readToken } from "../auth/token-store.js";
const DEFAULT_API_URL = "https://api.veryfront.com";
export async function readConfigFile(projectDir) {
    const fs = createFileSystem();
    for (const ext of [".ts", ".js"]) {
        const configPath = join(projectDir, `veryfront.config${ext}`);
        try {
            if (!(await fs.exists(configPath)))
                continue;
            const module = await import(`file://${configPath}`);
            const config = module.default ?? module;
            if (config?.projectSlug)
                return { projectSlug: config.projectSlug };
        }
        catch {
            // Ignore import errors, try next format
        }
    }
    const rcPath = join(projectDir, ".veryfrontrc");
    try {
        if (!(await fs.exists(rcPath)))
            return null;
        const content = await fs.readTextFile(rcPath);
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
function slugify(value) {
    return value.replace(/[^a-z0-9-]/gi, "-");
}
async function inferProjectSlug(projectDir) {
    const fs = createFileSystem();
    const packagePath = join(projectDir, "package.json");
    try {
        if (await fs.exists(packagePath)) {
            const content = await fs.readTextFile(packagePath);
            const pkg = JSON.parse(content);
            if (pkg.name)
                return slugify(pkg.name.replace(/^@[^/]+\//, ""));
        }
    }
    catch {
        // Ignore errors
    }
    const dirName = projectDir.split(/[/\\]/).pop();
    return dirName ? slugify(dirName) : null;
}
export async function resolveConfig(projectDir, env = getRuntimeEnv()) {
    const dir = projectDir ?? cwd();
    const configFile = await readConfigFile(dir);
    const apiUrl = env.apiUrl ?? configFile?.apiUrl ?? DEFAULT_API_URL;
    const apiToken = env.apiToken ?? configFile?.apiToken ?? (await readToken());
    if (!apiToken) {
        throw new Error("Missing API token. Run 'veryfront login' or set VERYFRONT_API_TOKEN environment variable");
    }
    const projectSlug = env.projectSlug ?? configFile?.projectSlug ?? (await inferProjectSlug(dir));
    if (!projectSlug) {
        throw new Error("Could not determine project slug. Set VERYFRONT_PROJECT_SLUG environment variable or add projectSlug to veryfront.config.ts");
    }
    return { apiUrl, apiToken, projectSlug };
}
export function createApiClient(config) {
    const { apiUrl, apiToken } = config;
    async function request(method, path, body, params) {
        const url = new URL(`${apiUrl}${path}`);
        if (params) {
            for (const [key, value] of Object.entries(params))
                url.searchParams.set(key, value);
        }
        const response = await dntShim.fetch(url.toString(), {
            method,
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
            try {
                const errorBody = (await response.json());
                errorMessage = errorBody.message || errorBody.error || errorMessage;
            }
            catch {
                // Ignore JSON parse errors
            }
            throw new Error(errorMessage);
        }
        if (response.status === 204)
            return undefined;
        return response.json();
    }
    return {
        get(path, params) {
            return request("GET", path, undefined, params);
        },
        post(path, body) {
            return request("POST", path, body);
        },
        put(path, body) {
            return request("PUT", path, body);
        },
        patch(path, body) {
            return request("PATCH", path, body);
        },
        delete(path) {
            return request("DELETE", path);
        },
    };
}
