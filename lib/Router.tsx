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

const RouterContext = React.createContext<Router | null>(null);

// SSR-safe default router
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
  const value = React.useContext(RouterContext);
  if (!value) {
    // Return default router for SSR instead of throwing
    return defaultRouter;
  }
  return value;
}

// Re-export RouterProvider as Router for backward compatibility
export { RouterProvider as Router };
