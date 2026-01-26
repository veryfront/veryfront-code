/**
 * OAuth Client for Veryfront API - client credentials flow.
 */
import * as dntShim from "../_dnt.shims.js";
import { injectContext, ProxySpanNames, withSpan } from "./tracing.js";
const DEFAULT_TIMEOUT_MS = 10000;
export async function fetchOAuthToken(config) {
    return await withSpan(ProxySpanNames.OAUTH_TOKEN_REQUEST, async () => {
        const url = `${config.apiBaseUrl}/auth/token`;
        const urlObj = new URL(url);
        const controller = new AbortController();
        const timeoutId = dntShim.setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        try {
            const headers = new dntShim.Headers({ "Content-Type": "application/json" });
            injectContext(headers);
            const response = await withSpan(ProxySpanNames.HTTP_CLIENT_FETCH, () => dntShim.fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    grant_type: "client_credentials",
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    ...(config.projectSlug && { project_slug: config.projectSlug }),
                    ...(config.customDomain && { custom_domain: config.customDomain }),
                }),
                signal: controller.signal,
            }), {
                "http.method": "POST",
                "http.url": url,
                "http.host": urlObj.host,
                "oauth.grant_type": "client_credentials",
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => "Unknown error");
                throw new Error(`OAuth token request failed: ${response.status} - ${errorText}`);
            }
            return response.json();
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`OAuth token request timed out after ${config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
            }
            throw error;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }, {
        "oauth.project_slug": config.projectSlug || "",
        "oauth.custom_domain": config.customDomain || "",
    });
}
