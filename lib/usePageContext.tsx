import React from "react";

export interface PageContext {
  slug: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  frontmatter?: Record<string, unknown>;
}

const PageContextValue = React.createContext<PageContext | null>(null);

// SSR-safe default context
const defaultPageContext: PageContext = {
  slug: "/",
  path: "/",
  params: {},
  query: {},
  frontmatter: {},
};

export function PageContextProvider({
  children,
  pageContext,
}: {
  children: React.ReactNode;
  pageContext?: PageContext;
}) {
  return (
    <PageContextValue.Provider value={pageContext || defaultPageContext}>
      {children}
    </PageContextValue.Provider>
  );
}

export function usePageContext(): PageContext {
  const value = React.useContext(PageContextValue);
  if (!value) {
    // Return default context for SSR instead of throwing
    return defaultPageContext;
  }
  return value;
}

export default usePageContext;
