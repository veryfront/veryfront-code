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

const RouterContext = React.createContext<RouterValue>(defaultRouter);

export interface RouterProviderProps {
  children: React.ReactNode;
  router?: RouterValue;
}

export function RouterProvider({
  children,
  router,
}: RouterProviderProps): React.ReactElement {
  return (
    <RouterContext.Provider value={router ?? defaultRouter}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter(): RouterValue {
  return React.useContext(RouterContext);
}

export { RouterProvider as Router };

// Link is defined here (not re-exported from components/Link.tsx) to avoid
// relative imports in embedded framework sources, which break compiled binary SSR.
export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  prefetch?: boolean;
};

export function Link({
  prefetch = true,
  children,
  ...rest
}: LinkProps): React.ReactElement {
  return (
    <a {...rest} data-prefetch={prefetch ? "true" : undefined}>
      {children}
    </a>
  );
}
