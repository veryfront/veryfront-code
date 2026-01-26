import { serverLogger as logger } from "./logger/index.js";
export class InMemoryBundleManifestStore {
    metadata = new Map();
    code = new Map();
    sourceIndex = new Map();
    getIfNotExpired(map, key) {
        const entry = map.get(key);
        if (!entry)
            return undefined;
        if (entry.expiry && Date.now() > entry.expiry) {
            map.delete(key);
            return undefined;
        }
        return entry.value;
    }
    getBundleMetadata(key) {
        return Promise.resolve(this.getIfNotExpired(this.metadata, key));
    }
    setBundleMetadata(key, metadata, ttlMs) {
        const expiry = ttlMs ? Date.now() + ttlMs : undefined;
        this.metadata.set(key, { value: metadata, expiry });
        let keys = this.sourceIndex.get(metadata.source);
        if (!keys) {
            keys = new Set();
            this.sourceIndex.set(metadata.source, keys);
        }
        keys.add(key);
        return Promise.resolve();
    }
    getBundleCode(hash) {
        return Promise.resolve(this.getIfNotExpired(this.code, hash));
    }
    setBundleCode(hash, code, ttlMs) {
        const expiry = ttlMs ? Date.now() + ttlMs : undefined;
        this.code.set(hash, { value: code, expiry });
        return Promise.resolve();
    }
    async deleteBundle(key) {
        const metadata = await this.getBundleMetadata(key);
        this.metadata.delete(key);
        if (!metadata)
            return;
        this.code.delete(metadata.codeHash);
        const sourceKeys = this.sourceIndex.get(metadata.source);
        if (!sourceKeys)
            return;
        sourceKeys.delete(key);
        if (sourceKeys.size === 0)
            this.sourceIndex.delete(metadata.source);
    }
    async invalidateSource(source) {
        const keys = this.sourceIndex.get(source);
        if (!keys)
            return 0;
        const keysArray = [...keys];
        await Promise.all(keysArray.map((key) => this.deleteBundle(key)));
        this.sourceIndex.delete(source);
        return keysArray.length;
    }
    clear() {
        this.metadata.clear();
        this.code.clear();
        this.sourceIndex.clear();
        return Promise.resolve();
    }
    isAvailable() {
        return Promise.resolve(true);
    }
    getStats() {
        let totalSize = 0;
        let oldestBundle;
        let newestBundle;
        for (const { value } of this.metadata.values()) {
            totalSize += value.size;
            oldestBundle = oldestBundle == null
                ? value.compiledAt
                : Math.min(oldestBundle, value.compiledAt);
            newestBundle = newestBundle == null
                ? value.compiledAt
                : Math.max(newestBundle, value.compiledAt);
        }
        return Promise.resolve({
            totalBundles: this.metadata.size,
            totalSize,
            oldestBundle,
            newestBundle,
        });
    }
}
let manifestStore = new InMemoryBundleManifestStore();
export function setBundleManifestStore(store) {
    manifestStore = store;
    logger.info("[bundle-manifest] Bundle manifest store configured", {
        type: store.constructor.name,
    });
}
export function getBundleManifestStore() {
    return manifestStore;
}
export { computeCodeHash, computeContentHash } from "./hash-utils.js";
