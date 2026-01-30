/**
 * Head Collector - Request-scoped metadata collection for SSR
 *
 * Collects head metadata during React SSR render using AsyncLocalStorage
 * for proper isolation between concurrent requests.
 *
 * Usage:
 *   const { result, head } = await runWithHeadCollector(() => renderToString(element));
 *   // head.title, head.description, head.metas are now available
 */
import { AsyncLocalStorage } from "node:async_hooks";
function createEmpty() {
    return { metas: [], links: [], styles: [] };
}
/**
 * AsyncLocalStorage for request-scoped head collection.
 * Each SSR request gets its own isolated CollectedHead instance.
 */
const headStorage = new AsyncLocalStorage();
/**
 * Run a function with isolated head collection context.
 *
 * @example
 * const { result: html, head } = await runWithHeadCollector(async () => {
 *   return await renderToString(pageElement);
 * });
 * // head.title, head.description, head.metas are now available
 */
export async function runWithHeadCollector(fn) {
    const collected = createEmpty();
    const result = await headStorage.run(collected, fn);
    return { result, head: collected };
}
/**
 * Get the current head collection context.
 * Returns null if not within a runWithHeadCollector context.
 */
export function getHeadCollectorContext() {
    return headStorage.getStore() ?? null;
}
/**
 * Collect head metadata during SSR render.
 * Called by Head component for each child element.
 *
 * Must be called within a runWithHeadCollector context.
 * Calls outside of context are silently ignored (client-side rendering).
 */
export function collectHead(data) {
    const collected = headStorage.getStore();
    if (!collected) {
        // Not in SSR context - silently ignore (e.g., client-side rendering)
        return;
    }
    if (data.title !== undefined)
        collected.title = data.title;
    if (data.description !== undefined)
        collected.description = data.description;
    if (data.metas?.length) {
        for (const meta of data.metas) {
            if (meta.name === "description" && meta.content) {
                collected.description = meta.content;
            }
            collected.metas.push(meta);
        }
    }
    if (data.links?.length)
        collected.links.push(...data.links);
    if (data.styles?.length)
        collected.styles.push(...data.styles);
}
/**
 * Check if any head data has been collected in the current context.
 */
export function hasCollectedHead() {
    const collected = headStorage.getStore();
    if (!collected)
        return false;
    return Boolean(collected.title ||
        collected.description ||
        collected.metas.length ||
        collected.links.length ||
        collected.styles.length);
}
/**
 * Reset the head collector for the current context.
 * Only works within a runWithHeadCollector context.
 */
export function resetHeadCollector() {
    const store = headStorage.getStore();
    if (store) {
        store.title = undefined;
        store.description = undefined;
        store.metas = [];
        store.links = [];
        store.styles = [];
    }
}
/**
 * Flush and return collected head data for the current context.
 * Only works within a runWithHeadCollector context.
 */
export function flushHeadCollector() {
    const store = headStorage.getStore();
    if (!store) {
        return createEmpty();
    }
    const result = {
        ...store,
        metas: [...store.metas],
        links: [...store.links],
        styles: [...store.styles],
    };
    store.title = undefined;
    store.description = undefined;
    store.metas = [];
    store.links = [];
    store.styles = [];
    return result;
}
