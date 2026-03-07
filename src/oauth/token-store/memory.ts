import type { OAuthState, OAuthTokens, TokenStore } from "../types.ts";

/** How long an OAuth state nonce remains valid (10 minutes). */
const STATE_EXPIRATION_MS = 10 * 60 * 1_000;

export class MemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthTokens>();
  private states = new Map<string, OAuthState>();

  async getTokens(serviceId: string): Promise<OAuthTokens | null> {
    return this.tokens.get(serviceId) ?? null;
  }

  async setTokens(serviceId: string, tokens: OAuthTokens): Promise<void> {
    this.tokens.set(serviceId, tokens);
  }

  async clearTokens(serviceId: string): Promise<void> {
    this.tokens.delete(serviceId);
  }

  async getState(state: string): Promise<OAuthState | null> {
    const oauthState = this.states.get(state);
    if (!oauthState) return null;

    if (Date.now() - oauthState.createdAt > STATE_EXPIRATION_MS) {
      this.states.delete(state);
      return null;
    }

    return oauthState;
  }

  async setState(oauthState: OAuthState): Promise<void> {
    this.states.set(oauthState.state, oauthState);
    this.cleanupExpiredStates();
  }

  async clearState(state: string): Promise<void> {
    this.states.delete(state);
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, oauthState] of this.states) {
      if (now - oauthState.createdAt > STATE_EXPIRATION_MS) {
        this.states.delete(state);
      }
    }
  }

  getConnectedServices(): string[] {
    return [...this.tokens.keys()];
  }

  isConnected(serviceId: string): boolean {
    const tokens = this.tokens.get(serviceId);
    if (!tokens) return false;

    const isExpired = tokens.expiresAt != null && Date.now() > tokens.expiresAt;
    return !isExpired || Boolean(tokens.refreshToken);
  }

  clearAll(): void {
    this.tokens.clear();
    this.states.clear();
  }
}

export const memoryTokenStore = new MemoryTokenStore();
