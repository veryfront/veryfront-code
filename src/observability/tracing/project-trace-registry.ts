import type { ProjectTraceConfig } from "#veryfront/server/project-env/telemetry-config.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";

export interface ProjectTraceSession {
  hasActiveSpans?(): boolean;
  /** Discard revokes queued/in-flight export; ordinary retirement drains first. */
  shutdown(discard: boolean): Promise<void>;
}

interface Entry<T extends ProjectTraceSession> {
  key: string;
  revision: string;
  ready: Promise<T | undefined>;
  session?: T;
  users: number;
  state: "current" | "retiring" | "closed";
  timer?: ReturnType<typeof setTimeout>;
  stopping?: Promise<void>;
  discard: boolean;
}

export interface ProjectTraceLease<T> {
  readonly session: T;
  release(): void;
}

/** Bounded, process-local ownership of project exporter generations. */
export class ProjectTraceRegistry<T extends ProjectTraceSession> {
  private readonly current = new Map<string, Entry<T>>();
  private readonly entries = new Set<Entry<T>>();
  private readonly maxEntries: number;
  private readonly idleMs: number;
  private readonly drainMs: number;
  private readonly initializeMs: number;
  private closed = false;

  constructor(
    private readonly create: (config: ProjectTraceConfig) => Promise<T>,
    options: { maxEntries?: number; idleMs?: number; drainMs?: number; initializeMs?: number } = {},
  ) {
    this.maxEntries = options.maxEntries ?? 32;
    this.idleMs = options.idleMs ?? 60_000;
    this.drainMs = options.drainMs ?? 4_000;
    this.initializeMs = options.initializeMs ?? 5_000;
    for (const value of [this.maxEntries, this.idleMs, this.drainMs, this.initializeMs]) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError("Invalid project trace registry limit");
      }
    }
  }

  private key(projectId: string, environmentId: string): string {
    return `${projectId.length}:${projectId}${environmentId.length}:${environmentId}`;
  }

  private clearTimer(entry: Entry<T>): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private stop(entry: Entry<T>, discard: boolean): Promise<void> {
    entry.discard ||= discard;
    entry.state = "closed";
    this.clearTimer(entry);
    if (this.current.get(entry.key) === entry) this.current.delete(entry.key);
    if (entry.stopping) {
      if (discard && entry.session) void entry.session.shutdown(true).catch(() => {});
      return entry.stopping;
    }
    entry.stopping = entry.ready.then(async (session) => {
      if (!session) return;
      const force = setTimeout(() => {
        void session.shutdown(true).catch(() => {});
      }, this.drainMs);
      unrefTimer(force);
      try {
        await session.shutdown(entry.discard);
      } finally {
        clearTimeout(force);
      }
    }).catch(() => {}).finally(() => this.entries.delete(entry));
    return entry.stopping;
  }

  private retire(entry: Entry<T>): void {
    if (entry.state !== "current") return;
    entry.state = "retiring";
    if (this.current.get(entry.key) === entry) this.current.delete(entry.key);
    this.clearTimer(entry);
    if (entry.users === 0 && !entry.session?.hasActiveSpans?.()) {
      void this.stop(entry, false);
      return;
    }
    entry.timer = setTimeout(() => {
      void this.stop(entry, true);
    }, this.drainMs);
    unrefTimer(entry.timer);
  }

  private release(entry: Entry<T>): void {
    entry.users--;
    if (entry.users !== 0 || entry.state === "closed") return;
    if (entry.state === "retiring") {
      if (!entry.session?.hasActiveSpans?.()) void this.stop(entry, false);
      return;
    }
    entry.timer = setTimeout(() => {
      void this.stop(entry, entry.session?.hasActiveSpans?.() === true);
    }, this.idleMs);
    unrefTimer(entry.timer);
  }

  private async bounded<R>(
    promise: Promise<R>,
    milliseconds: number,
    expired: () => void,
  ): Promise<R | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            expired();
            resolve(undefined);
          }, milliseconds);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async acquire(config: ProjectTraceConfig): Promise<ProjectTraceLease<T> | undefined> {
    if (this.closed) return undefined;
    const key = this.key(config.projectId, config.environmentId);
    let entry = this.current.get(key);
    if (entry && entry.revision !== config.revision) {
      this.retire(entry);
      entry = undefined;
    }
    if (!entry) {
      // Entries being initialized/drained still count against the process budget.
      if (this.entries.size >= this.maxEntries) {
        const idle = [...this.entries].find((candidate) =>
          candidate.users === 0 && candidate.session && !candidate.session.hasActiveSpans?.() &&
          candidate.state !== "closed"
        );
        if (idle) await this.bounded(this.stop(idle, true), this.drainMs, () => {});
      }
      if (this.closed || this.entries.size >= this.maxEntries) return undefined;
      // Capacity eviction awaited; another caller may have initialized this scope meanwhile.
      entry = this.current.get(key);
      if (entry && entry.revision !== config.revision) return undefined;
      if (!entry) {
        const created: Entry<T> = {
          key,
          revision: config.revision,
          users: 0,
          state: "current",
          discard: false,
          ready: Promise.resolve().then(() => this.create(config)).then((session) => {
            created.session = session;
            return session;
          }).catch(() => {
            void this.stop(created, true);
            return undefined;
          }),
        };
        this.entries.add(created);
        this.current.set(key, created);
        entry = created;
      }
    }
    const acquired = entry;
    this.clearTimer(acquired);
    acquired.users++;
    const session = await this.bounded(acquired.ready, this.initializeMs, () => {
      void this.stop(acquired, true);
    });
    if (!session || acquired.state === "closed" || this.closed) {
      this.release(acquired);
      return undefined;
    }
    let released = false;
    return Object.freeze({
      session,
      release: () => {
        if (released) return;
        released = true;
        this.release(acquired);
      },
    });
  }

  async disable(projectId: string, environmentId: string): Promise<void> {
    const key = this.key(projectId, environmentId);
    const stopping = [...this.entries].filter((entry) => entry.key === key).map((entry) =>
      this.stop(entry, true)
    );
    await this.bounded(Promise.all(stopping), this.drainMs, () => {});
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const entries = [...this.entries];
    await this.bounded(
      Promise.all(entries.map((entry) => this.stop(entry, false))),
      this.drainMs,
      () => {
        for (const entry of entries) void this.stop(entry, true);
      },
    );
  }

  async flush(operation: (session: T) => Promise<void>): Promise<void> {
    await Promise.all([...this.entries].map(async (entry) => {
      const session = await entry.ready;
      if (session && entry.state !== "closed") await operation(session);
    }));
  }
}
