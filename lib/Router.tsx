import React from "react";

export interface Router {
  domain: string;
  path: string;
  pathname: string;
  params: Record<string, string>;
  query: Record<string, string>;
  isPreview: boolean;
  isMounted: boolean;
  navigate: (path: string | PathObject, options?: NavigateOptions) => Promise<void>;
  push: (path: string | PathObject, options?: NavigateOptions) => Promise<void>;
  replace: (path: string | PathObject, options?: NavigateOptions) => Promise<void>;
  reload: () => Promise<void>;
}

type PathObject = {
  pathname: string;
  query?: Record<string, string>;
  search?: Record<string, string>;
};

type NavigateOptions = {
  keepScrollPosition?: boolean;
  overwriteLastHistoryEntry?: boolean;
};

// SSR-safe default router - used when no provider is present
// This ensures useContext(RouterContext) never returns null, even during SSR
const defaultRouter: Router = {
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
const RouterContext = React.createContext<Router>(defaultRouter);

export function RouterProvider({
  children,
  router,
}: {
  children: React.ReactNode;
  router?: Router;
}) {
  return (
    <RouterContext.Provider value={router || defaultRouter}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter(): Router {
  // Context is initialized with defaultRouter, so this never returns null
  return React.useContext(RouterContext);
}

// Re-export RouterProvider as Router for backward compatibility
export { RouterProvider as Router };
