/**
 * In-Memory Token Store
 *
 * Simple in-memory storage for OAuth tokens and state.
 * Suitable for development and single-instance deployments.
 */

import type { OAuthState, OAuthTokens, TokenStore } from "../types.ts";

/**
 * In-memory token store implementation
 */
export class MemoryTokenStore implements TokenStore {
  private tokens: Map<string, OAuthTokens> = new Map();
  private states: Map<string, OAuthState> = new Map();

  /** State expiration time in ms (10 minutes) */
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

    // Return null if not found or expired
    if (!oauthState || Date.now() - oauthState.createdAt > this.stateExpirationMs) {
      if (oauthState) this.states.delete(state);
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

  /**
   * Clean up expired states
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, oauthState] of this.states) {
      if (now - oauthState.createdAt > this.stateExpirationMs) {
        this.states.delete(state);
      }
    }
  }

  /**
   * Get all stored service IDs
   */
  getConnectedServices(): string[] {
    return Array.from(this.tokens.keys());
  }

  /**
   * Check if a service is connected
   */
  isConnected(serviceId: string): boolean {
    const tokens = this.tokens.get(serviceId);
    if (!tokens) return false;

    // Token expired but might be refreshable
    const isExpired = tokens.expiresAt && Date.now() > tokens.expiresAt;
    return !isExpired || !!tokens.refreshToken;
  }

  /**
   * Clear all tokens
   */
  clearAll(): void {
    this.tokens.clear();
    this.states.clear();
  }
}

/**
 * Default in-memory token store instance
 */
export const memoryTokenStore = new MemoryTokenStore();
