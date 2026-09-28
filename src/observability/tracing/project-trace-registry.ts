import {
  allPrivatePromises,
  chainPrivatePromise,
  createPrivateDeferred,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { filterPrivateArray, mapPrivateArray } from "#veryfront/security/private-array.ts";
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
  private readonly current = createPrivateMap<string, Entry<T>>();
  private readonly entries = createPrivateSet<Entry<T>>();
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
    // An expired initializer must not reserve capacity forever. The ready handler
    // below still closes any session it eventually produces.
    if (!entry.session) this.entries.delete(entry);
    if (entry.stopping) {
      if (discard && entry.session) {
        void chainPrivatePromise(entry.session.shutdown(true), () => {}, () => {});
      }
      return entry.stopping;
    }
    const stopped = chainPrivatePromise(entry.ready, async (session) => {
      if (!session) return;
      const force = setTimeout(() => {
        void chainPrivatePromise(session.shutdown(true), () => {}, () => {});
      }, this.drainMs);
      unrefTimer(force);
      try {
        await session.shutdown(entry.discard);
      } finally {
        clearTimeout(force);
      }
    });
    const finish = () => {
      this.entries.delete(entry);
    };
    entry.stopping = chainPrivatePromise(stopped, finish, finish);
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
    const completion = createPrivateDeferred<R | undefined>();
    const timer = setTimeout(() => {
      expired();
      completion.resolve(undefined);
    }, milliseconds);
    void chainPrivatePromise(promise, completion.resolve, completion.reject);
    try {
      return await completion.promise;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Use a ready generation immediately; initialize missing generations in the background. */
  tryAcquire(config: ProjectTraceConfig): ProjectTraceLease<T> | undefined {
    if (this.closed) return undefined;
    const entry = this.current.get(this.key(config.projectId, config.environmentId));
    if (entry?.revision === config.revision && entry.state === "current") {
      if (!entry.session) return undefined;
      this.clearTimer(entry);
      entry.users++;
      return this.lease(entry, entry.session);
    }
    void chainPrivatePromise(this.acquire(config), (lease) => lease?.release(), () => {});
    return undefined;
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
        let idle: Entry<T> | undefined;
        for (const candidate of this.entries) {
          if (
            candidate.users === 0 && candidate.session && !candidate.session.hasActiveSpans?.() &&
            candidate.state !== "closed"
          ) {
            idle = candidate;
            break;
          }
        }
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
          ready: chainPrivatePromise(
            chainPrivatePromise(resolvePrivatePromise(), () => this.create(config)),
            (session): T | undefined => {
              created.session = session;
              return session;
            },
            () => {
              void this.stop(created, true);
              return undefined;
            },
          ),
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
    return this.lease(acquired, session);
  }

  private lease(acquired: Entry<T>, session: T): ProjectTraceLease<T> {
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
    const stopping = mapPrivateArray(
      filterPrivateArray([...this.entries], (entry) => entry.key === key),
      (entry) => this.stop(entry, true),
    );
    await this.bounded(allPrivatePromises(stopping), this.drainMs, () => {});
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const entries = [...this.entries];
    await this.bounded(
      allPrivatePromises(mapPrivateArray(entries, (entry) => this.stop(entry, false))),
      this.drainMs,
      () => {
        for (const entry of entries) void this.stop(entry, true);
      },
    );
  }

  async flush(operation: (session: T) => Promise<void>): Promise<void> {
    await allPrivatePromises(mapPrivateArray([...this.entries], async (entry) => {
      const session = await entry.ready;
      if (session && entry.state !== "closed") await operation(session);
    }));
  }
}
