import * as React from "react";

/**
 * Request-owned capabilities made available to framework components while
 * React renders a server tree. Values live in a React provider, rather than a
 * process-global slot, so suspended work retains the request that created it.
 */
export interface ServerRenderContextValue {
  readonly nonce?: string;
  readonly registerHeadPayload: (payload: string) => string;
}

const SERVER_RENDER_CONTEXT_REGISTRY_SYMBOL = Symbol.for(
  "veryfront.react.server-render-context-registry.v2",
);

type ReactContextRuntime = Pick<
  typeof React,
  "createContext" | "createElement" | "useContext"
>;

interface ServerRenderContextRegistry {
  get(react: ReactContextRuntime): unknown;
}

function createServerRenderContextRegistry(): ServerRenderContextRegistry {
  // A React namespace and its default export can be distinct objects, while
  // their createContext function is the same runtime identity. Keying by that
  // function keeps bundled copies aligned without mixing React 18 and 19.
  const contexts = new WeakMap<ReactContextRuntime["createContext"], unknown>();
  return Object.freeze({
    get(react: ReactContextRuntime): unknown {
      const createContext = react?.createContext;
      if (typeof createContext !== "function") {
        throw new TypeError("Server render context requires a valid React runtime");
      }
      const installed = contexts.get(createContext);
      if (installed) return installed;
      const context = createContext<ServerRenderContextValue | null>(null);
      if (!context || typeof context !== "object") {
        throw new TypeError("React createContext returned an invalid context");
      }
      contexts.set(createContext, context);
      return context;
    },
  });
}

const contextOwner = globalThis as typeof globalThis & {
  [SERVER_RENDER_CONTEXT_REGISTRY_SYMBOL]?: ServerRenderContextRegistry;
};
const installedRegistry = Reflect.getOwnPropertyDescriptor(
  contextOwner,
  SERVER_RENDER_CONTEXT_REGISTRY_SYMBOL,
);
if (!installedRegistry) {
  Object.defineProperty(contextOwner, SERVER_RENDER_CONTEXT_REGISTRY_SYMBOL, {
    value: createServerRenderContextRegistry(),
    configurable: false,
    enumerable: false,
    writable: false,
  });
} else if (
  installedRegistry.configurable !== false ||
  installedRegistry.writable !== false ||
  !Object.isFrozen(installedRegistry.value) ||
  typeof installedRegistry.value?.get !== "function"
) {
  throw new TypeError("Server render context registry integrity check failed");
}

/**
 * The shared object identity is deliberate: project bundles may evaluate
 * framework modules through different URLs, while a React context provider
 * and consumer must still agree on the same context object. No request value
 * is stored globally; request data is carried only by the provider stack.
 */
export function getServerRenderContext(
  react: ReactContextRuntime = React as ReactContextRuntime,
): unknown {
  return contextOwner[SERVER_RENDER_CONTEXT_REGISTRY_SYMBOL]!.get(react);
}

export function useServerRenderContext(): ServerRenderContextValue | null {
  const runtime = React as ReactContextRuntime;
  return runtime.useContext(
    getServerRenderContext(runtime) as React.Context<ServerRenderContextValue | null>,
  );
}

export function wrapWithServerRenderContext(
  element: React.ReactNode,
  value: ServerRenderContextValue | undefined,
  react: ReactContextRuntime = React as ReactContextRuntime,
): React.ReactNode {
  if (!value) return element;
  const context = getServerRenderContext(react) as { Provider?: unknown };
  if (!context.Provider) throw new TypeError("React context is missing its Provider");
  return react.createElement(
    context.Provider as React.ElementType,
    { value },
    element,
  ) as React.ReactNode;
}
