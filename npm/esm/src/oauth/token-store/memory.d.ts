import type { OAuthState, OAuthTokens, TokenStore } from "../types.js";
export declare class MemoryTokenStore implements TokenStore {
    private tokens;
    private states;
    /** State expiration time in ms (10 minutes) */
    private stateExpirationMs;
    getTokens(serviceId: string): Promise<OAuthTokens | null>;
    setTokens(serviceId: string, tokens: OAuthTokens): Promise<void>;
    clearTokens(serviceId: string): Promise<void>;
    getState(state: string): Promise<OAuthState | null>;
    setState(oauthState: OAuthState): Promise<void>;
    clearState(state: string): Promise<void>;
    private cleanupExpiredStates;
    getConnectedServices(): string[];
    isConnected(serviceId: string): boolean;
    clearAll(): void;
}
export declare const memoryTokenStore: MemoryTokenStore;
//# sourceMappingURL=memory.d.ts.map