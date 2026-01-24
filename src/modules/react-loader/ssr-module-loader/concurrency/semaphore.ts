export class Semaphore {
  private permits: number;
  private waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  tryAcquire(timeoutMs = 100): Promise<boolean> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;

      const onAcquire = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(true);
      };

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;

        const index = this.waitQueue.findIndex((w) => w.resolve === onAcquire);
        if (index !== -1) this.waitQueue.splice(index, 1);

        resolve(false);
      }, timeoutMs);

      this.waitQueue.push({ resolve: onAcquire, reject: onAcquire });
    });
  }

  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next.resolve();
      return;
    }
    this.permits++;
  }

  get available(): number {
    return this.permits;
  }

  get waiting(): number {
    return this.waitQueue.length;
  }
}
