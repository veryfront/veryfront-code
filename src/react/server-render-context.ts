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

const SERVER_RENDER_CONTEXT_SYMBOL = Symbol.for(
  "veryfront.react.server-render-context.v1",
);

type ServerRenderContext = React.Context<ServerRenderContextValue | null>;

const contextOwner = globalThis as typeof globalThis & {
  [SERVER_RENDER_CONTEXT_SYMBOL]?: ServerRenderContext;
};

const installedContext = Reflect.getOwnPropertyDescriptor(
  contextOwner,
  SERVER_RENDER_CONTEXT_SYMBOL,
);

if (!installedContext) {
  Object.defineProperty(contextOwner, SERVER_RENDER_CONTEXT_SYMBOL, {
    value: React.createContext<ServerRenderContextValue | null>(null),
    configurable: false,
    enumerable: false,
    writable: false,
  });
} else if (!installedContext.value) {
  throw new TypeError("Server render context integrity check failed");
}

/**
 * The shared object identity is deliberate: project bundles may evaluate
 * framework modules through different URLs, while a React context provider
 * and consumer must still agree on the same context object. No request value
 * is stored globally; request data is carried only by the provider stack.
 */
export const ServerRenderContext = contextOwner[SERVER_RENDER_CONTEXT_SYMBOL]!;

export function useServerRenderContext(): ServerRenderContextValue | null {
  return React.useContext(ServerRenderContext);
}

export function wrapWithServerRenderContext(
  element: React.ReactNode,
  value: ServerRenderContextValue | undefined,
): React.ReactNode {
  if (!value) return element;
  return React.createElement(ServerRenderContext.Provider, { value }, element);
}
