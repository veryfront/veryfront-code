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

const RouterContext = React.createContext<RouterValue | null>(null);

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
  const value = React.useContext(RouterContext);
  if (!value) {
    return defaultRouter;
  }
  return value;
}

export { RouterProvider as Router };
