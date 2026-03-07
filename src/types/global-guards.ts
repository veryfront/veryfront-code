export type { GlobalWithBun, GlobalWithDeno, GlobalWithProcess } from "#veryfront/utils";
export { hasBunRuntime, hasDenoRuntime, hasNodeProcess } from "#veryfront/utils";

export interface GlobalWithReactDOM {
  ReactDOM?: typeof import("react-dom/client");
}

export interface GlobalWithVeryFrontCache {
  __VF_CACHE_NAMESPACE__?: string;
}

export function hasReactDOM(global: unknown): global is GlobalWithReactDOM {
  if (typeof global !== "object" || global === null) return false;
  return "ReactDOM" in global &&
    typeof (global as Record<string, unknown>)["ReactDOM"] !== "undefined";
}

export function hasVeryFrontCache(global: unknown): global is GlobalWithVeryFrontCache {
  if (typeof global !== "object" || global === null) return false;
  return "__VF_CACHE_NAMESPACE__" in global;
}
