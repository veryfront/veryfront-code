export type {
  GlobalWithBun,
  GlobalWithDeno,
  GlobalWithProcess,
} from "#veryfront/utils/runtime-guards.ts";
export { hasBunRuntime, hasDenoRuntime, hasNodeProcess } from "#veryfront/utils/runtime-guards.ts";

/** Global object that exposes the React DOM client renderer. */
export interface GlobalWithReactDOM {
  /** React DOM client methods used by browser hydration. */
  ReactDOM: Pick<typeof import("react-dom/client"), "createRoot">;
}

/** Global object that carries Veryfront's optional cache namespace. */
export interface GlobalWithVeryFrontCache {
  /** Namespace used to isolate global cache entries. */
  __VF_CACHE_NAMESPACE__?: string;
}

/** Returns whether a value exposes a callable React DOM `createRoot` method. */
export function hasReactDOM(global: unknown): global is GlobalWithReactDOM {
  if (typeof global !== "object" || global === null) return false;
  try {
    const reactDOMDescriptor = Reflect.getOwnPropertyDescriptor(global, "ReactDOM");
    if (!reactDOMDescriptor || !("value" in reactDOMDescriptor)) return false;
    const reactDOM = reactDOMDescriptor.value;
    if (typeof reactDOM !== "object" || reactDOM === null) return false;
    const createRootDescriptor = Reflect.getOwnPropertyDescriptor(reactDOM, "createRoot");
    return typeof reactDOM === "object" && reactDOM !== null &&
      !!createRootDescriptor && "value" in createRootDescriptor &&
      typeof createRootDescriptor.value === "function";
  } catch {
    return false;
  }
}

/** Returns whether a value owns a valid Veryfront cache namespace property. */
export function hasVeryFrontCache(global: unknown): global is GlobalWithVeryFrontCache {
  if (typeof global !== "object" || global === null) return false;
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(global, "__VF_CACHE_NAMESPACE__");
    if (!descriptor || !("value" in descriptor)) return false;
    const namespace = descriptor.value;
    return typeof namespace === "undefined" || typeof namespace === "string";
  } catch {
    return false;
  }
}
