import * as React from "react";

/**
 * Use a layout effect in browsers without emitting React's server-rendering
 * warning when a primitive is rendered on the server.
 */
export const useIsomorphicLayoutEffect = typeof globalThis.document === "undefined"
  ? React.useEffect
  : React.useLayoutEffect;
