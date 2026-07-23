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
const DEFAULT_MAX_SESSIONS = 10_000;

/** Reason an MCP session left the in-memory session store. */
export type SessionRemovalReason = "expired" | "terminated" | "cleared";

/** Limits and lifecycle hooks for the Streamable HTTP session manager. */
export interface SessionManagerOptions {
  /** Inactivity TTL in ms (default 30 minutes). */
  ttlMs?: number;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** Maximum number of active sessions retained in memory. */
  maxSessions?: number;
  /** Called after a session is removed. */
  onRemove?: (id: string, reason: SessionRemovalReason) => void;
}

/** Bounded inactivity-based session store for the Streamable HTTP transport. */
export class SessionManager {
  /** id -> last-seen timestamp (ms). */
  private sessions = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxSessions: number;
  private readonly onRemove?: (
    id: string,
    reason: SessionRemovalReason,
  ) => void;
  private sessionHeaderRequired = false;

  /** Create a session manager with validated retention limits. */
  constructor(options: SessionManagerOptions = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new TypeError("The session TTL must be a positive integer");
    }
    if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
      throw new TypeError(
        "The maximum session count must be a positive integer",
      );
    }

    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.now = options.now ?? Date.now;
    this.onRemove = options.onRemove;
  }

  /** Create and retain a cryptographically random session identifier. */
  create(): string {
    const now = this.currentTime();
    this.pruneExpired(now);
    if (this.sessions.size >= this.maxSessions) {
      throw new RangeError(
        `The maximum session count of ${this.maxSessions} has been reached`,
      );
    }

    let id = crypto.randomUUID();
    for (let attempt = 0; this.sessions.has(id); attempt++) {
      if (attempt >= 9) {
        throw new Error("Unable to generate a unique session ID");
      }
      id = crypto.randomUUID();
    }
    this.sessions.set(id, now);
    this.sessionHeaderRequired = true;
    return id;
  }

  /** Validate and refresh an active session identifier. */
  isValid(id: string): boolean {
    const lastSeen = this.sessions.get(id);
    if (lastSeen === undefined) return false;
    const now = this.currentTime();
    if (this.isExpired(lastSeen, now)) {
      this.remove(id, "expired");
      return false;
    }
    // Touch: activity refreshes the inactivity window.
    this.sessions.set(id, now);
    return true;
  }

  /** Terminate one session if it exists. */
  terminate(id: string): void {
    this.remove(id, "terminated");
    if (this.sessions.size === 0) this.sessionHeaderRequired = false;
  }

  /** Number of unexpired sessions currently retained. */
  get size(): number {
    this.pruneExpired(this.currentTime());
    return this.sessions.size;
  }

  /** Remove every retained session and notify the lifecycle hook. */
  clear(): void {
    const ids = [...this.sessions.keys()];
    this.sessions.clear();
    this.sessionHeaderRequired = false;
    for (const id of ids) this.onRemove?.(id, "cleared");
  }

  /** Report if post-initialization requests must carry a session header. */
  requiresSessionHeader(): boolean {
    return this.sessionHeaderRequired;
  }

  /** Read and validate the configured clock. */
  private currentTime(): number {
    const now = this.now();
    if (!Number.isFinite(now)) {
      throw new TypeError("The session clock must return a finite number");
    }
    return now;
  }

  /** Report if an inactivity timestamp has exceeded the configured TTL. */
  private isExpired(lastSeen: number, now: number): boolean {
    return now - lastSeen >= this.ttlMs;
  }

  /** Remove sessions whose inactivity window has elapsed. */
  private pruneExpired(now: number): void {
    const cutoff = now - this.ttlMs;
    for (const [id, lastSeen] of this.sessions) {
      if (lastSeen <= cutoff) this.remove(id, "expired");
    }
  }

  /** Remove one session and emit its lifecycle notification. */
  private remove(id: string, reason: SessionRemovalReason): boolean {
    if (!this.sessions.delete(id)) return false;
    this.onRemove?.(id, reason);
    return true;
  }
}
