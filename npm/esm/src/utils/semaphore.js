/**
 * Semaphore: Concurrency Limiter
 *
 * Limits concurrent operations to prevent resource exhaustion.
 *
 * @module utils/semaphore
 */
import * as dntShim from "../../_dnt.shims.js";
export class SemaphoreTimeoutError extends Error {
    constructor(name, timeoutMs) {
        super(`Semaphore '${name}' acquire timeout after ${timeoutMs}ms`);
        this.name = "SemaphoreTimeoutError";
    }
}
export class Semaphore {
    permits;
    maxPermits;
    waiting = [];
    acquireTimeoutMs;
    semaphoreName;
    constructor(maxPermits, options = {}) {
        this.maxPermits = maxPermits;
        this.permits = maxPermits;
        this.acquireTimeoutMs = options.acquireTimeoutMs ?? 0;
        this.semaphoreName = options.name ?? "default";
    }
    /** Acquire permit, execute operation, release automatically */
    async acquire(operation) {
        await this.waitForPermit();
        try {
            return await operation();
        }
        finally {
            this.release();
        }
    }
    waitForPermit() {
        if (this.permits > 0) {
            this.permits--;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const task = { resolve, reject };
            if (this.acquireTimeoutMs > 0) {
                task.timeoutId = dntShim.setTimeout(() => {
                    const idx = this.waiting.indexOf(task);
                    if (idx !== -1)
                        this.waiting.splice(idx, 1);
                    reject(new SemaphoreTimeoutError(this.semaphoreName, this.acquireTimeoutMs));
                }, this.acquireTimeoutMs);
            }
            this.waiting.push(task);
        });
    }
    release() {
        const next = this.waiting.shift();
        if (next) {
            if (next.timeoutId)
                clearTimeout(next.timeoutId);
            next.resolve();
            return;
        }
        this.permits++;
    }
    get active() {
        return this.maxPermits - this.permits;
    }
    get waitingCount() {
        return this.waiting.length;
    }
}
const semaphores = new Map();
export function getSemaphore(name, maxPermits, options) {
    const existing = semaphores.get(name);
    if (existing)
        return existing;
    const sem = new Semaphore(maxPermits, { ...options, name });
    semaphores.set(name, sem);
    return sem;
}
