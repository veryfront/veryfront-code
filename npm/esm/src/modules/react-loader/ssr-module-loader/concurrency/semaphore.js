import * as dntShim from "../../../../../_dnt.shims.js";
export class Semaphore {
    permits;
    waitQueue = [];
    constructor(permits) {
        this.permits = permits;
    }
    tryAcquire(timeoutMs = 100) {
        if (this.permits > 0) {
            this.permits--;
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            let settled = false;
            const onAcquire = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeoutId);
                resolve(true);
            };
            const timeoutId = dntShim.setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                const index = this.waitQueue.findIndex((w) => w.resolve === onAcquire);
                if (index !== -1)
                    this.waitQueue.splice(index, 1);
                resolve(false);
            }, timeoutMs);
            this.waitQueue.push({ resolve: onAcquire, reject: onAcquire });
        });
    }
    release() {
        const next = this.waitQueue.shift();
        if (next) {
            next.resolve();
            return;
        }
        this.permits++;
    }
    get available() {
        return this.permits;
    }
    get waiting() {
        return this.waitQueue.length;
    }
}
