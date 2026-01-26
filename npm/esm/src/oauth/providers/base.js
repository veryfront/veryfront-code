import * as dntShim from "../../../_dnt.shims.js";
import { getEnv } from "../../platform/compat/process.js";
function generateRandomString(length) {
    const array = new Uint8Array(length);
    dntShim.crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, length);
}
function generateCodeVerifier() {
    return generateRandomString(64);
}
async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const hash = await dntShim.crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
export class OAuthProvider {
    config;
    envReader;
    constructor(config, envReader = getEnv) {
        this.config = config;
        this.envReader = envReader;
    }
    getClientId() {
        return this.envReader(this.config.clientIdEnvVar) ?? null;
    }
    getClientSecret() {
        return this.envReader(this.config.clientSecretEnvVar) ?? null;
    }
    isConfigured() {
        return !!(this.getClientId() && this.getClientSecret());
    }
    async createAuthorizationUrl(options = {}) {
        const clientId = this.getClientId();
        if (!clientId)
            throw new Error(`${this.config.clientIdEnvVar} not configured`);
        const state = options.state ?? generateRandomString(32);
        const scopes = options.scopes ?? options.defaultScopes ?? [];
        const redirectUri = options.redirectUri ?? "";
        const usePkce = options.usePkce !== false;
        let codeVerifier;
        let codeChallenge;
        if (usePkce) {
            codeVerifier = generateCodeVerifier();
            codeChallenge = await generateCodeChallenge(codeVerifier);
        }
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            state,
            ...(scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
            ...(codeChallenge
                ? {
                    code_challenge: codeChallenge,
                    code_challenge_method: "S256",
                }
                : {}),
            ...this.config.additionalAuthParams,
            ...options.additionalParams,
        });
        return {
            url: `${this.config.authorizationUrl}?${params.toString()}`,
            state: {
                state,
                codeVerifier,
                redirectUri,
                scopes,
                createdAt: Date.now(),
            },
        };
    }
    buildTokenHeaders(clientId, clientSecret) {
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        };
        if (this.config.useBasicAuth) {
            headers.Authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
        }
        return headers;
    }
    parseTokenResponse(data, fallbackRefreshToken) {
        const mapping = this.config.tokenResponseMapping ?? {};
        const accessToken = data[mapping.accessToken ?? "access_token"];
        const refreshToken = data[mapping.refreshToken ?? "refresh_token"] ??
            fallbackRefreshToken;
        const tokenType = data[mapping.tokenType ?? "token_type"];
        const scope = data[mapping.scope ?? "scope"];
        const idToken = data.id_token;
        const tokens = {
            accessToken,
            refreshToken,
            tokenType,
            scope,
            idToken,
        };
        const expiresIn = data[mapping.expiresIn ?? "expires_in"];
        if (expiresIn)
            tokens.expiresAt = Date.now() + expiresIn * 1000;
        return tokens;
    }
    async postTokenRequest(body, clientId, clientSecret) {
        const response = await dntShim.fetch(this.config.tokenUrl, {
            method: "POST",
            headers: this.buildTokenHeaders(clientId, clientSecret),
            body: body.toString(),
        });
        const data = await response.json();
        return { response, data };
    }
    async exchangeCode(options) {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();
        if (!clientId || !clientSecret) {
            return {
                success: false,
                error: "OAuth not configured",
                errorDescription: `Missing ${this.config.clientIdEnvVar} or ${this.config.clientSecretEnvVar}`,
            };
        }
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            code: options.code,
            redirect_uri: options.redirectUri,
            ...(options.codeVerifier ? { code_verifier: options.codeVerifier } : {}),
            ...(!this.config.useBasicAuth
                ? {
                    client_id: clientId,
                    client_secret: clientSecret,
                }
                : {}),
            ...this.config.additionalTokenParams,
        });
        try {
            const { response, data } = await this.postTokenRequest(body, clientId, clientSecret);
            if (!response.ok) {
                return {
                    success: false,
                    error: data.error || "token_exchange_failed",
                    errorDescription: data.error_description || `Status ${response.status}`,
                };
            }
            return { success: true, tokens: this.parseTokenResponse(data) };
        }
        catch (error) {
            return {
                success: false,
                error: "network_error",
                errorDescription: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }
    async refreshTokens(refreshToken) {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();
        if (!clientId || !clientSecret) {
            return { success: false, error: "OAuth not configured" };
        }
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            ...(!this.config.useBasicAuth
                ? {
                    client_id: clientId,
                    client_secret: clientSecret,
                }
                : {}),
        });
        try {
            const { response, data } = await this.postTokenRequest(body, clientId, clientSecret);
            if (!response.ok) {
                return {
                    success: false,
                    error: data.error || "refresh_failed",
                    errorDescription: data.error_description,
                };
            }
            return { success: true, tokens: this.parseTokenResponse(data, refreshToken) };
        }
        catch (error) {
            return {
                success: false,
                error: "network_error",
                errorDescription: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }
    async revokeToken(token) {
        const revocationUrl = this.config.revocationUrl;
        if (!revocationUrl)
            return false;
        try {
            const response = await dntShim.fetch(revocationUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ token }).toString(),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
}
export class OAuthService extends OAuthProvider {
    serviceConfig;
    tokenStore;
    constructor(config, tokenStore, envReader) {
        super(config, envReader);
        this.serviceConfig = config;
        this.tokenStore = tokenStore;
    }
    get serviceId() {
        return this.serviceConfig.serviceId;
    }
    get apiBaseUrl() {
        return this.serviceConfig.apiBaseUrl;
    }
    createAuthorizationUrl(options = {}) {
        return super.createAuthorizationUrl({
            ...options,
            defaultScopes: this.serviceConfig.defaultScopes,
        });
    }
    async getAccessToken() {
        const tokens = await this.tokenStore?.getTokens(this.serviceId);
        if (!tokens)
            return null;
        const isExpired = tokens.expiresAt && Date.now() > tokens.expiresAt - 300000;
        if (!isExpired)
            return tokens.accessToken;
        if (!tokens.refreshToken)
            return null;
        const result = await this.refreshTokens(tokens.refreshToken);
        if (!result.success || !result.tokens)
            return null;
        await this.tokenStore.setTokens(this.serviceId, result.tokens);
        return result.tokens.accessToken;
    }
    async fetch(endpoint, options = {}) {
        const token = await this.getAccessToken();
        if (!token)
            throw new Error(`Not authenticated with ${this.serviceConfig.displayName}`);
        const url = endpoint.startsWith("http") ? endpoint : `${this.apiBaseUrl}${endpoint}`;
        const response = await dntShim.fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...options.headers,
            },
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`${this.serviceConfig.displayName} API error: ${response.status} ${error}`);
        }
        return response.json();
    }
}
