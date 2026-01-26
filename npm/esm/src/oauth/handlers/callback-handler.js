/**
 * OAuth Callback Handler
 *
 * Reusable handler for OAuth callback routes.
 */
import * as dntShim from "../../../_dnt.shims.js";
import { logger } from "../../utils/index.js";
import { getEnv } from "../../platform/compat/process.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
import { OAuthService } from "../providers/base.js";
import { memoryTokenStore } from "../token-store/memory.js";
/**
 * Create an OAuth callback route handler
 *
 * @example
 * ```typescript
 * // app/api/auth/gmail/callback/route.ts
 * import { createOAuthCallbackHandler } from "veryfront/oauth";
 * import { gmailConfig } from "veryfront/oauth/providers";
 *
 * export const GET = createOAuthCallbackHandler(gmailConfig);
 * ```
 */
export function createOAuthCallbackHandler(config, options = {}) {
    const { tokenStore = memoryTokenStore, baseUrl, successRedirect = "/", errorRedirect = "/", onSuccess, onError, env = getRuntimeEnv(), envReader = getEnv, } = options;
    return async function handler(request) {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");
        const appUrl = baseUrl ?? env.appUrl ?? "http://localhost:3000";
        function redirectWithError(errorCode, description) {
            const errorUrl = new URL(errorRedirect, appUrl);
            errorUrl.searchParams.set("error", errorCode);
            if (description)
                errorUrl.searchParams.set("error_description", description);
            return dntShim.Response.redirect(errorUrl.toString());
        }
        async function handleError(errorCode, logMessage, logData) {
            if (logMessage)
                logger.error(logMessage, { data: logData });
            await onError?.(config.serviceId, errorCode);
            return redirectWithError(errorCode);
        }
        if (oauthError) {
            logger.error("[OAuth] Callback error", {
                serviceId: config.serviceId,
                error: oauthError,
                description: errorDescription,
            });
            await onError?.(config.serviceId, oauthError);
            return redirectWithError(oauthError, errorDescription);
        }
        if (!code)
            return handleError("no_code");
        let oauthState = null;
        if (state) {
            oauthState = await tokenStore.getState(state);
            if (!oauthState) {
                logger.warn("[OAuth] Invalid or expired state", { serviceId: config.serviceId });
                // Continue anyway - some providers don't properly return state
            }
        }
        const service = new OAuthService(config, tokenStore, envReader);
        const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;
        try {
            const result = await service.exchangeCode({
                code,
                redirectUri,
                codeVerifier: oauthState?.codeVerifier,
            });
            if (!result.success || !result.tokens) {
                return handleError(result.error ?? "token_exchange_failed", `Token exchange failed for ${config.serviceId}:`, result.error);
            }
            await tokenStore.setTokens(config.serviceId, result.tokens);
            if (state)
                await tokenStore.clearState(state);
            await onSuccess?.(config.serviceId, result.tokens);
            const successUrl = new URL(successRedirect, appUrl);
            successUrl.searchParams.set("connected", config.serviceId);
            return dntShim.Response.redirect(successUrl.toString());
        }
        catch (error) {
            return handleError("callback_error", `OAuth callback error for ${config.serviceId}:`, error);
        }
    };
}
