import denoConfig from "../../deno.js";
import { getVeryfrontVersion } from "../config/env.js";
export const VERSION = getVeryfrontVersion() ??
    (typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0");
export const SERVER_START_TIME = Date.now();
export function createBuildVersion(projectUpdatedAt) {
    return {
        framework: VERSION,
        serverStart: SERVER_START_TIME,
        projectUpdated: projectUpdatedAt,
    };
}
