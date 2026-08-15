import * as React from "react";

/**
 * Use a layout effect in browsers without emitting React's server-rendering
 * warning when a primitive is rendered on the server.
 */
export const useIsomorphicLayoutEffect: typeof React.useLayoutEffect = (effect, deps) => {
  const useEffectHook = typeof globalThis.document === "undefined"
    ? React.useEffect
    : React.useLayoutEffect;
  return useEffectHook(effect, deps);
};
