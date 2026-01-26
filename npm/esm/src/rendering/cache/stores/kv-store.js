import * as dntShim from "../../../../_dnt.shims.js";
export class KVCacheStore {
    kv = null;
    path;
    constructor(options = {}) {
        this.path = options.path;
    }
    async ensureKV() {
        if (this.kv)
            return this.kv;
        const openKv = dntShim.dntGlobalThis.Deno?.openKv;
        if (!openKv)
            return null;
        const instance = await openKv(this.path);
        if (!instance || typeof instance.get !== "function")
            return null;
        const kv = instance;
        this.kv = {
            get: kv.get.bind(instance),
            set: kv.set.bind(instance),
            delete: kv.delete.bind(instance),
            close: typeof kv.close === "function" ? kv.close.bind(instance) : undefined,
            list: typeof kv.list === "function" ? kv.list.bind(instance) : undefined,
        };
        return this.kv;
    }
    async get(key) {
        const kv = await this.ensureKV();
        if (!kv)
            return undefined;
        const result = await kv.get(["veryfront", "render", key]);
        return result.value ?? undefined;
    }
    async set(key, value) {
        const kv = await this.ensureKV();
        if (!kv)
            return;
        await kv.set(["veryfront", "render", key], value);
    }
    async delete(key) {
        const kv = await this.ensureKV();
        if (!kv)
            return;
        await kv.delete(["veryfront", "render", key]);
    }
    async deleteByPrefix(prefix) {
        const kv = await this.ensureKV();
        if (!kv?.list)
            return 0;
        let deleted = 0;
        for await (const entry of kv.list({ prefix: ["veryfront", "render"] })) {
            const key = entry.key?.[2];
            if (typeof key !== "string")
                continue;
            if (!key.startsWith(prefix))
                continue;
            await kv.delete(entry.key);
            deleted++;
        }
        return deleted;
    }
    async clear() {
        const kv = await this.ensureKV();
        if (!kv?.list)
            return;
        for await (const entry of kv.list({ prefix: ["veryfront", "render"] })) {
            await kv.delete(entry.key);
        }
    }
    async destroy() {
        await this.kv?.close?.();
        this.kv = null;
    }
}
