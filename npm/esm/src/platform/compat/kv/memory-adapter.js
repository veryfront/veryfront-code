export class MemoryKv {
    store = new Map();
    keyToString(key) {
        return JSON.stringify(key);
    }
    stringToKey(keyStr) {
        return JSON.parse(keyStr);
    }
    get(key) {
        const entry = this.store.get(this.keyToString(key));
        if (!entry)
            return Promise.resolve({ value: undefined });
        return Promise.resolve({ value: entry.value, versionstamp: entry.versionstamp });
    }
    set(key, value) {
        this.store.set(this.keyToString(key), { value, versionstamp: Date.now().toString() });
        return Promise.resolve();
    }
    delete(key) {
        this.store.delete(this.keyToString(key));
        return Promise.resolve();
    }
    async *list(options) {
        const entries = Array.from(this.store.entries());
        let filtered = entries;
        if (options?.prefix) {
            const prefixStr = this.keyToString(options.prefix);
            filtered = filtered.filter(([key]) => key.startsWith(prefixStr.slice(0, -1)));
        }
        filtered.sort((a, b) => {
            const result = a[0].localeCompare(b[0]);
            return options?.reverse ? -result : result;
        });
        if (options?.start) {
            const startStr = this.keyToString(options.start);
            filtered = filtered.filter(([key]) => key >= startStr);
        }
        if (options?.end) {
            const endStr = this.keyToString(options.end);
            filtered = filtered.filter(([key]) => key < endStr);
        }
        if (options?.limit != null) {
            filtered = filtered.slice(0, options.limit);
        }
        for (const [keyStr, entry] of filtered) {
            yield {
                key: this.stringToKey(keyStr),
                value: entry.value,
                versionstamp: entry.versionstamp,
            };
        }
    }
    close() {
        this.store.clear();
    }
}
