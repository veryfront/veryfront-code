export type { GlobalWithBun, GlobalWithDeno, GlobalWithProcess } from "../utils/index.js";
export { hasBunRuntime, hasDenoRuntime, hasNodeProcess } from "../utils/index.js";
export interface GlobalWithReactDOM {
    ReactDOM?: typeof import("react-dom/client");
}
export interface GlobalWithVeryFrontCache {
    __VF_CACHE_NAMESPACE__?: string;
}
export declare function hasReactDOM(global: unknown): global is GlobalWithReactDOM;
export declare function hasVeryFrontCache(global: unknown): global is GlobalWithVeryFrontCache;
//# sourceMappingURL=global-guards.d.ts.map