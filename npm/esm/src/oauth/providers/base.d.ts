import * as dntShim from "../../../_dnt.shims.js";
import type { AuthorizationUrlOptions, OAuthProviderConfig, OAuthServiceConfig, OAuthState, TokenExchangeOptions, TokenExchangeResult, TokenStore } from "../types.js";
export type EnvReader = (key: string) => string | undefined;
export declare class OAuthProvider {
    protected config: OAuthProviderConfig;
    protected envReader: EnvReader;
    constructor(config: OAuthProviderConfig, envReader?: EnvReader);
    getClientId(): string | null;
    getClientSecret(): string | null;
    isConfigured(): boolean;
    createAuthorizationUrl(options?: AuthorizationUrlOptions & {
        defaultScopes?: string[];
    }): Promise<{
        url: string;
        state: OAuthState;
    }>;
    private buildTokenHeaders;
    private parseTokenResponse;
    private postTokenRequest;
    exchangeCode(options: TokenExchangeOptions): Promise<TokenExchangeResult>;
    refreshTokens(refreshToken: string): Promise<TokenExchangeResult>;
    revokeToken(token: string): Promise<boolean>;
}
export declare class OAuthService extends OAuthProvider {
    protected serviceConfig: OAuthServiceConfig;
    protected tokenStore?: TokenStore;
    constructor(config: OAuthServiceConfig, tokenStore?: TokenStore, envReader?: EnvReader);
    get serviceId(): string;
    get apiBaseUrl(): string;
    createAuthorizationUrl(options?: AuthorizationUrlOptions): Promise<{
        url: string;
        state: OAuthState;
    }>;
    getAccessToken(): Promise<string | null>;
    fetch<T>(endpoint: string, options?: dntShim.RequestInit): Promise<T>;
}
//# sourceMappingURL=base.d.ts.map