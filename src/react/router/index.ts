/**
 * Router exports for veryfront/router
 * Provides client-side routing context and hooks
 */
import React from "react";

export interface RouterValue {
  domain: string;
  path: string;
  pathname: string;
  params: Record<string, string>;
  query: Record<string, string>;
  isPreview: boolean;
  isMounted: boolean;
  navigate: (url: string) => Promise<void>;
  push: (url: string) => Promise<void>;
  replace: (url: string) => Promise<void>;
  reload: () => Promise<void>;
}

// SSR-safe default router - used when no provider is present
// This ensures useContext(RouterContext) never returns null, even during SSR
const defaultRouter: RouterValue = {
  domain: "",
  path: "/",
  pathname: "/",
  params: {},
  query: {},
  isPreview: false,
  isMounted: false,
  navigate: async () => {},
  push: async () => {},
  replace: async () => {},
  reload: async () => {},
};

// Initialize context with defaultRouter instead of null
// This prevents "Cannot read properties of null" errors when user code
// accesses the context directly (without using useRouter hook) during SSR
const RouterContext = React.createContext<RouterValue>(defaultRouter);

export interface RouterProviderProps {
  children: React.ReactNode;
  router?: RouterValue;
}

export function RouterProvider({ children, router }: RouterProviderProps) {
  return React.createElement(RouterContext.Provider, {
    value: router || defaultRouter,
    children,
  });
}

export function useRouter(): RouterValue {
  // Context is initialized with defaultRouter, so this never returns null
  return React.useContext(RouterContext);
}

export { RouterProvider as Router };
