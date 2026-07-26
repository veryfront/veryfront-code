type WaiterKind = "shared" | "exclusive";

interface Waiter {
  kind: WaiterKind;
  resolve: () => void;
}

/**
 * FIFO asynchronous reader/writer gate.
 *
 * Point operations may run concurrently. Prefix invalidation is exclusive so
 * a set cannot finish after clear/deleteByPrefix and resurrect stale data.
 */
export class AsyncOperationGate {
  private activeReaders = 0;
  private writerActive = false;
  private readonly waiters: Waiter[] = [];

  private acquireShared(): Promise<void> {
    if (!this.writerActive && this.waiters.length === 0) {
      this.activeReaders++;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiters.push({ kind: "shared", resolve });
    });
  }

  private acquireExclusive(): Promise<void> {
    if (!this.writerActive && this.activeReaders === 0 && this.waiters.length === 0) {
      this.writerActive = true;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiters.push({ kind: "exclusive", resolve });
    });
  }

  private drain(): void {
    if (this.writerActive || this.activeReaders > 0) return;

    const first = this.waiters[0];
    if (!first) return;

    if (first.kind === "exclusive") {
      this.waiters.shift();
      this.writerActive = true;
      first.resolve();
      return;
    }

    while (this.waiters[0]?.kind === "shared") {
      const reader = this.waiters.shift()!;
      this.activeReaders++;
      reader.resolve();
    }
  }

  private releaseShared(): void {
    this.activeReaders--;
    if (this.activeReaders < 0) {
      this.activeReaders = 0;
      throw new Error("Repository operation gate released a shared permit twice");
    }
    this.drain();
  }

  private releaseExclusive(): void {
    if (!this.writerActive) {
      throw new Error("Repository operation gate released an exclusive permit twice");
    }
    this.writerActive = false;
    this.drain();
  }

  async runShared<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireShared();
    try {
      return await operation();
    } finally {
      this.releaseShared();
    }
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireExclusive();
    try {
      return await operation();
    } finally {
      this.releaseExclusive();
    }
  }
}
