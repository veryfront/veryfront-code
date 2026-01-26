import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { serverLogger } from "../../../utils/index.js";
export function isValidSecurityConfig(config) {
    if (config == null || typeof config !== "object")
        return false;
    const cfg = config;
    if (cfg.csp !== undefined && (cfg.csp == null || typeof cfg.csp !== "object"))
        return false;
    if (cfg.cors !== undefined && typeof cfg.cors !== "boolean" &&
        (cfg.cors == null || typeof cfg.cors !== "object")) {
        return false;
    }
    if (cfg.coop !== undefined && typeof cfg.coop !== "string")
        return false;
    if (cfg.corp !== undefined && typeof cfg.corp !== "string")
        return false;
    if (cfg.coep !== undefined && typeof cfg.coep !== "string")
        return false;
    return true;
}
export function loadSecurityConfig(projectDir, adapter) {
    return withSpan("security.config.load", async () => {
        try {
            const { getConfig } = await import("../../../config/index.js");
            const cfg = await getConfig(projectDir, adapter);
            const securityConfig = cfg?.security;
            if (!securityConfig)
                return null;
            if (!isValidSecurityConfig(securityConfig)) {
                serverLogger.warn("Invalid security configuration structure, ignoring");
                return null;
            }
            return securityConfig;
        }
        catch {
            return null;
        }
    }, { "security.projectDir": projectDir });
}
