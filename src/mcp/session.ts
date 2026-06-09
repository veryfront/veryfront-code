/**
 * Manages MCP sessions for the Streamable HTTP transport.
 * Sessions are created during initialization and validated on subsequent requests.
 *
 * Sessions expire after a period of inactivity so that clients which disconnect
 * uncleanly (closed tab, crash, dropped network) don't leak entries forever.
 * Expiry is lazy: stale entries are pruned on access, so no background timer is
 * required.
 */

/** Default inactivity window before a session is considered expired (30 min). */
const DEFAULT_SESSION_TTL_MS = 30 * 60_000;

export interface SessionManagerOptions {
  /** Inactivity TTL in ms (default 30 minutes). */
  ttlMs?: number;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

export class SessionManager {
  /** id -> last-seen timestamp (ms). */
  private sessions = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private sessionHeaderRequired = false;

  constructor(options: SessionManagerOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  create(): string {
    this.pruneExpired();
    const id = crypto.randomUUID();
    this.sessions.set(id, this.now());
    this.sessionHeaderRequired = true;
    return id;
  }

  isValid(id: string): boolean {
    const lastSeen = this.sessions.get(id);
    if (lastSeen === undefined) return false;
    if (this.isExpired(lastSeen)) {
      this.sessions.delete(id);
      return false;
    }
    // Touch: activity refreshes the inactivity window.
    this.sessions.set(id, this.now());
    return true;
  }

  terminate(id: string): void {
    this.sessions.delete(id);
    if (this.sessions.size === 0) this.sessionHeaderRequired = false;
  }

  get size(): number {
    this.pruneExpired();
    return this.sessions.size;
  }

  clear(): void {
    this.sessions.clear();
    this.sessionHeaderRequired = false;
  }

  requiresSessionHeader(): boolean {
    return this.sessionHeaderRequired;
  }

  private isExpired(lastSeen: number): boolean {
    return this.now() - lastSeen > this.ttlMs;
  }

  private pruneExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, lastSeen] of this.sessions) {
      if (lastSeen < cutoff) this.sessions.delete(id);
    }
  }
}
