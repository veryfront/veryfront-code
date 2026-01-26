export const ENV_VARS = {
    DEBUG: "VERYFRONT_DEBUG",
    DEEP_INSPECT: "VERYFRONT_DEEP_INSPECT",
    CACHE_DIR: "VERYFRONT_CACHE_DIR",
    PORT: "VERYFRONT_PORT",
    VERSION: "VERYFRONT_VERSION",
};
export function isTruthyEnvValue(value) {
    if (!value)
        return false;
    const normalized = value.toLowerCase().trim();
    return normalized === "1" || normalized === "true" || normalized === "yes";
}
export function isDebugEnabled(env) {
    return isTruthyEnvValue(env.get(ENV_VARS.DEBUG));
}
export function isDeepInspectEnabled(env) {
    return isTruthyEnvValue(env.get(ENV_VARS.DEEP_INSPECT));
}
export function isAnyDebugEnabled(env) {
    return isDebugEnabled(env) || isDeepInspectEnabled(env);
}
