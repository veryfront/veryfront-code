import { MemoryCacheStore } from "./stores/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
export class CacheCoordinator {
    store;
    ttlMs;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs;
        this.store = options.store ??
            new MemoryCacheStore({
                maxEntries: options.memory?.maxEntries,
                ttlMs: options.memory?.ttlMs ?? options.ttlMs,
            });
    }
    checkCache(slug) {
        return withSpan("cache.checkCache", async () => {
            const cached = await this.store.get(slug);
            if (!cached) {
                return { depAwareSlug: slug, moduleCacheKey: slug };
            }
            if (this.isExpired(cached)) {
                await this.store.delete(slug);
                return { depAwareSlug: slug, moduleCacheKey: slug };
            }
            return {
                cachedResult: cached.result,
                depAwareSlug: slug,
                moduleCacheKey: slug,
                cachedModule: cached.result.pageModule,
            };
        }, { "cache.slug": slug });
    }
    persistResult(result, slug) {
        return withSpan("cache.persistResult", async () => {
            if (result.stream) {
                return;
            }
            const now = Date.now();
            const payload = {
                result: {
                    html: result.html,
                    css: result.css,
                    frontmatter: result.frontmatter,
                    headings: result.headings,
                    nodeMap: result.nodeMap,
                    stream: null,
                    ssrHash: result.ssrHash,
                    pageModule: result.pageModule,
                },
                storedAt: now,
                expiresAt: this.ttlMs ? now + this.ttlMs : undefined,
            };
            await this.store.set(slug, payload);
        }, { "cache.slug": slug });
    }
    async clearAll() {
        await this.store.clear();
    }
    async clearSlug(slug) {
        await this.store.delete(slug);
    }
    async destroy() {
        await this.store.destroy();
    }
    isExpired(entry) {
        return typeof entry.expiresAt === "number" && Date.now() > entry.expiresAt;
    }
}
