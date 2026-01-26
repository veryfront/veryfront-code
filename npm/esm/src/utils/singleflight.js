export class Singleflight {
    inflight = new Map();
    async do(key, operation) {
        const existing = this.inflight.get(key);
        if (existing)
            return existing;
        const promise = operation();
        this.inflight.set(key, promise);
        try {
            return await promise;
        }
        finally {
            this.inflight.delete(key);
        }
    }
    has(key) {
        return this.inflight.has(key);
    }
    get size() {
        return this.inflight.size;
    }
}
