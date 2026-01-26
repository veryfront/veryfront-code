import * as dntShim from "../../../_dnt.shims.js";
import { logger } from "../../utils/index.js";
import { OAuthService } from "../providers/base.js";
import { memoryTokenStore } from "../token-store/memory.js";
import { getEnv } from "../../platform/compat/process.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
export function createOAuthInitHandler(config, options = {}) {
    const tokenStore = options.tokenStore ?? memoryTokenStore;
    const baseUrl = options.baseUrl;
    const authOptions = options.authOptions ?? {};
    const env = options.env ?? getRuntimeEnv();
    const envReader = options.envReader ?? getEnv;
    return async function handler() {
        const service = new OAuthService(config, tokenStore, envReader);
        if (!service.isConfigured()) {
            return dntShim.Response.json({
                error: `${config.displayName} OAuth not configured`,
                details: `Missing ${config.clientIdEnvVar} or ${config.clientSecretEnvVar}`,
            }, { status: 500 });
        }
        const appUrl = baseUrl ?? env.appUrl ?? "http://localhost:3000";
        const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;
        try {
            const { url, state } = await service.createAuthorizationUrl({ ...authOptions, redirectUri });
            await tokenStore.setState(state);
            return dntShim.Response.redirect(url);
        }
        catch (error) {
            logger.error("[OAuth] Init error", { serviceId: config.serviceId }, error);
            return dntShim.Response.json({
                error: "Failed to initiate OAuth flow",
                details: error instanceof Error ? error.message : "Unknown error",
            }, { status: 500 });
        }
    };
}
export function createOAuthStatusHandler(config, options = {}) {
    const tokenStore = options.tokenStore ?? memoryTokenStore;
    const envReader = options.envReader ?? getEnv;
    return async function handler() {
        const tokens = await tokenStore.getTokens(config.serviceId);
        const isConnected = !!tokens?.accessToken;
        const isExpired = tokens?.expiresAt ? Date.now() > tokens.expiresAt : false;
        const hasRefreshToken = !!tokens?.refreshToken;
        return dntShim.Response.json({
            service: config.serviceId,
            displayName: config.displayName,
            connected: isConnected && (!isExpired || hasRefreshToken),
            configured: !!(envReader(config.clientIdEnvVar) && envReader(config.clientSecretEnvVar)),
            expiresAt: tokens?.expiresAt,
            hasRefreshToken,
        });
    };
}
export function createOAuthDisconnectHandler(config, options = {}) {
    const tokenStore = options.tokenStore ?? memoryTokenStore;
    return async function handler() {
        await tokenStore.clearTokens(config.serviceId);
        return dntShim.Response.json({
            success: true,
            message: `Disconnected from ${config.displayName}`,
        });
    };
}
