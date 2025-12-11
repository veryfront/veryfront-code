
import type { OAuthState, OAuthTokens, TokenStore } from "../types.ts";

export class MemoryTokenStore implements TokenStore {
  private tokens: Map<string, OAuthTokens> = new Map();
  private states: Map<string, OAuthState> = new Map();

  private stateExpirationMs = 10 * 60 * 1000;

  getTokens(serviceId: string): Promise<OAuthTokens | null> {
    return Promise.resolve(this.tokens.get(serviceId) || null);
  }

  setTokens(serviceId: string, tokens: OAuthTokens): Promise<void> {
    this.tokens.set(serviceId, tokens);
    return Promise.resolve();
  }

  clearTokens(serviceId: string): Promise<void> {
    this.tokens.delete(serviceId);
    return Promise.resolve();
  }

  getState(state: string): Promise<OAuthState | null> {
    const oauthState = this.states.get(state);
    if (!oauthState) {
      return Promise.resolve(null);
    }

    if (Date.now() - oauthState.createdAt > this.stateExpirationMs) {
      this.states.delete(state);
      return Promise.resolve(null);
    }

    return Promise.resolve(oauthState);
  }

  setState(oauthState: OAuthState): Promise<void> {
    this.states.set(oauthState.state, oauthState);
    this.cleanupExpiredStates();
    return Promise.resolve();
  }

  clearState(state: string): Promise<void> {
    this.states.delete(state);
    return Promise.resolve();
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, oauthState] of this.states) {
      if (now - oauthState.createdAt > this.stateExpirationMs) {
        this.states.delete(state);
      }
    }
  }

  getConnectedServices(): string[] {
    return Array.from(this.tokens.keys());
  }

  isConnected(serviceId: string): boolean {
    const tokens = this.tokens.get(serviceId);
    if (!tokens) return false;

    if (tokens.expiresAt && Date.now() > tokens.expiresAt) {
      return !!tokens.refreshToken;
    }

    return true;
  }

  clearAll(): void {
    this.tokens.clear();
    this.states.clear();
  }
}

export const memoryTokenStore = new MemoryTokenStore();
