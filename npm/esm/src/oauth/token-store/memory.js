export class MemoryTokenStore {
    tokens = new Map();
    states = new Map();
    /** State expiration time in ms (10 minutes) */
    stateExpirationMs = 10 * 60 * 1000;
    getTokens(serviceId) {
        return Promise.resolve(this.tokens.get(serviceId) ?? null);
    }
    setTokens(serviceId, tokens) {
        this.tokens.set(serviceId, tokens);
        return Promise.resolve();
    }
    clearTokens(serviceId) {
        this.tokens.delete(serviceId);
        return Promise.resolve();
    }
    getState(state) {
        const oauthState = this.states.get(state);
        if (!oauthState)
            return Promise.resolve(null);
        if (Date.now() - oauthState.createdAt > this.stateExpirationMs) {
            this.states.delete(state);
            return Promise.resolve(null);
        }
        return Promise.resolve(oauthState);
    }
    setState(oauthState) {
        this.states.set(oauthState.state, oauthState);
        this.cleanupExpiredStates();
        return Promise.resolve();
    }
    clearState(state) {
        this.states.delete(state);
        return Promise.resolve();
    }
    cleanupExpiredStates() {
        const now = Date.now();
        for (const [state, oauthState] of this.states) {
            if (now - oauthState.createdAt > this.stateExpirationMs)
                this.states.delete(state);
        }
    }
    getConnectedServices() {
        return [...this.tokens.keys()];
    }
    isConnected(serviceId) {
        const tokens = this.tokens.get(serviceId);
        if (!tokens)
            return false;
        const isExpired = tokens.expiresAt != null && Date.now() > tokens.expiresAt;
        return !isExpired || !!tokens.refreshToken;
    }
    clearAll() {
        this.tokens.clear();
        this.states.clear();
    }
}
export const memoryTokenStore = new MemoryTokenStore();
