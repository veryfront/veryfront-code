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
/** Hard ceiling preventing unbounded unauthenticated initialize traffic. */
const DEFAULT_MAX_SESSIONS = 1024;

export interface SessionManagerOptions {
  /** Inactivity TTL in ms (default 30 minutes). */
  ttlMs?: number;
  /** Maximum number of simultaneously live sessions (default 1024). */
  maxSessions?: number;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** Lifecycle hook used by owners to release session-scoped state. */
  onSessionRemoved?: (sessionId: string) => void;
}

/** Owns bounded, inactivity-expiring MCP session identifiers. */
export class SessionManager {
  /** id -> last-seen timestamp (ms). */
  private sessions = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;
  private readonly onSessionRemoved: ((sessionId: string) => void) | undefined;
  private sessionHeaderRequired = false;

  constructor(options: SessionManagerOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.now = options.now ?? Date.now;
    this.onSessionRemoved = options.onSessionRemoved;

    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new TypeError("Session TTL must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.maxSessions) || this.maxSessions <= 0) {
      throw new TypeError("MCP session capacity must be a positive safe integer");
    }
    if (typeof this.now !== "function") {
      throw new TypeError("Session clock must be a function");
    }
    if (
      this.onSessionRemoved !== undefined &&
      typeof this.onSessionRemoved !== "function"
    ) {
      throw new TypeError("Session removal callback must be a function");
    }
  }

  create(): string {
    this.pruneExpired();
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(
        `MCP session capacity reached (${this.maxSessions} live sessions)`,
      );
    }
    const id = crypto.randomUUID();
    this.sessions.set(id, this.readNow());
    this.sessionHeaderRequired = true;
    return id;
  }

  /** Checks whether a session is live without extending its inactivity window. */
  isActive(id: string): boolean {
    const lastSeen = this.sessions.get(id);
    if (lastSeen === undefined) return false;
    if (this.isExpired(lastSeen)) {
      this.remove(id);
      return false;
    }
    return true;
  }

  /** Extends a live session's inactivity window. */
  touch(id: string): boolean {
    if (!this.isActive(id)) return false;
    this.sessions.set(id, this.readNow());
    return true;
  }

  isValid(id: string): boolean {
    return this.touch(id);
  }

  terminate(id: string): boolean {
    if (!this.remove(id)) return false;
    if (this.sessions.size === 0) this.sessionHeaderRequired = false;
    return true;
  }

  get size(): number {
    this.pruneExpired();
    return this.sessions.size;
  }

  clear(): void {
    for (const id of Array.from(this.sessions.keys())) this.remove(id);
    this.sessionHeaderRequired = false;
  }

  requiresSessionHeader(): boolean {
    return this.sessionHeaderRequired;
  }

  private isExpired(lastSeen: number): boolean {
    return this.readNow() - lastSeen > this.ttlMs;
  }

  private pruneExpired(): void {
    const cutoff = this.readNow() - this.ttlMs;
    for (const [id, lastSeen] of this.sessions) {
      if (lastSeen < cutoff) this.remove(id);
    }
  }

  private readNow(): number {
    const now = this.now();
    if (!Number.isFinite(now)) {
      throw new TypeError("Session clock must return a finite timestamp");
    }
    return now;
  }

  private remove(id: string): boolean {
    if (!this.sessions.delete(id)) return false;
    this.onSessionRemoved?.(id);
    return true;
  }
}
