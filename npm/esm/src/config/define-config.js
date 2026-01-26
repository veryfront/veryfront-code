import { createError, toError } from "../errors/veryfront-error.js";
import { getRuntimeEnv } from "./runtime-env.js";
export function defineConfig(config) {
    return config;
}
export function defineConfigWithEnv(factory, runtimeEnv = getRuntimeEnv()) {
    return factory(runtimeEnv.nodeEnv);
}
export function mergeConfigs(...configs) {
    return Object.assign({}, ...configs);
}
export async function validateConfig(config) {
    if (!config || typeof config !== "object") {
        throw toError(createError({
            type: "config",
            message: "Configuration must be an object",
        }));
    }
    const cfg = config;
    const dev = cfg.dev;
    if (dev && typeof dev === "object") {
        const port = dev.port;
        if (port !== undefined) {
            const { MIN_PORT, MAX_PORT } = await import("../utils/constants/network.js");
            if (typeof port !== "number" || port < MIN_PORT || port > MAX_PORT) {
                throw toError(createError({
                    type: "config",
                    message: `dev.port must be a number between ${MIN_PORT} and ${MAX_PORT}`,
                    context: {
                        field: "dev.port",
                        value: port,
                        expected: `number between ${MIN_PORT} and ${MAX_PORT}`,
                    },
                }));
            }
        }
    }
    const build = cfg.build;
    if (build && typeof build === "object") {
        const outDir = build.outDir;
        if (outDir !== undefined && typeof outDir !== "string") {
            throw toError(createError({
                type: "config",
                message: "build.outDir must be a string",
                context: { field: "build.outDir", value: outDir, expected: "string" },
            }));
        }
    }
}
