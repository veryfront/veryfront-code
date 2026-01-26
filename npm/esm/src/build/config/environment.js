import { getEnvironmentFromEnv } from "../../config/env.js";
function isEnvironment(value) {
    return value === "development" || value === "production" || value === "test";
}
export function getEnvironment() {
    const veryfrontEnv = getEnvironmentFromEnv();
    if (isEnvironment(veryfrontEnv))
        return veryfrontEnv;
    return "development";
}
export function isDevelopment() {
    return getEnvironment() === "development";
}
export function isProduction() {
    return getEnvironment() === "production";
}
export function isTest() {
    return getEnvironment() === "test";
}
export function getBuildConfig() {
    const environment = getEnvironment();
    const isDevelopment = environment === "development";
    const isProduction = environment === "production";
    const isTest = environment === "test";
    return {
        environment,
        isDevelopment,
        isProduction,
        isTest,
        cacheMaxEntries: isDevelopment ? 10 : 100,
        cacheTTLMs: isDevelopment ? 0 : 3600000,
        minify: isProduction,
        sourcemaps: isDevelopment ? "inline" : false,
        treeShaking: isProduction,
        target: isProduction ? ["es2020"] : ["esnext"],
    };
}
export function getDefineEnv() {
    return JSON.stringify(getEnvironment());
}
