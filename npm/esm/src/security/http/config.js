import { getConfig } from "../../config/index.js";
import { serverLogger } from "../../utils/index.js";
import { buildCSP, generateNonce } from "./response/security-handler.js";
export class SecurityConfigLoader {
    projectDir;
    adapter;
    configOverride;
    securityConfig = null;
    cspUserHeader = null;
    isLoaded = false;
    loadPromise = null;
    constructor(projectDir, adapter, configOverride) {
        this.projectDir = projectDir;
        this.adapter = adapter;
        this.configOverride = configOverride;
    }
    async ensureLoaded() {
        if (this.isLoaded)
            return;
        if (this.loadPromise)
            return this.loadPromise;
        this.loadPromise = this.load();
        await this.loadPromise;
    }
    async load() {
        try {
            const cfg = this.configOverride ?? await getConfig(this.projectDir, this.adapter);
            this.applyConfig(cfg);
        }
        catch (error) {
            // Config is optional, so we don't throw
            serverLogger.debug("[SecurityConfigLoader] Failed to load config:", error);
            this.isLoaded = true; // Mark as loaded even on error to prevent retry
        }
    }
    applyConfig(cfg) {
        const security = cfg?.security ? { ...cfg.security } : {};
        if (security.headers) {
            security.headers = { ...security.headers };
        }
        security.cors ??= true;
        this.securityConfig = security;
        this.cspUserHeader = this.parseCspUserHeader(security.csp);
        this.isLoaded = true;
    }
    parseCspUserHeader(csp) {
        if (!csp || typeof csp !== "object")
            return null;
        const pieces = [];
        for (const [k, v] of Object.entries(csp)) {
            if (v === undefined)
                continue;
            const key = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
            const val = Array.isArray(v) ? v.join(" ") : String(v);
            pieces.push(`${key} ${val}`);
        }
        return pieces.length ? pieces.join("; ") : null;
    }
    getSecurityConfig() {
        return this.securityConfig;
    }
    getCspUserHeader() {
        return this.cspUserHeader;
    }
    getCorsConfig() {
        return this.securityConfig?.cors;
    }
    buildCsp(isDev, nonce = generateNonce()) {
        return buildCSP(isDev, nonce, this.cspUserHeader, this.securityConfig, this.adapter);
    }
    getSecurityHeader(headerName, defaultValue) {
        const configKey = headerName.toLowerCase();
        const configValue = this.securityConfig?.[configKey];
        const envValue = this.adapter.env.get(`VERYFRONT_${headerName}`);
        return (typeof configValue === "string" ? configValue : undefined) || envValue || defaultValue;
    }
    reset() {
        this.securityConfig = null;
        this.cspUserHeader = null;
        this.isLoaded = false;
        this.loadPromise = null;
    }
}
