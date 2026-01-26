export interface TokenResponse {
    access_token: string;
    token_type: "Bearer";
    expires_in?: number;
}
export interface OAuthTokenConfig {
    apiBaseUrl: string;
    clientId: string;
    clientSecret: string;
    projectSlug?: string;
    customDomain?: string;
    timeoutMs?: number;
}
export declare function fetchOAuthToken(config: OAuthTokenConfig): Promise<TokenResponse>;
//# sourceMappingURL=oauth-client.d.ts.map