/**
 * Page context exports for veryfront/context
 * Provides page context for MDX pages
 */
import React from "react";

export interface PageContextValue {
  slug: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  frontmatter: Record<string, unknown>;
}

const PageContextContext = React.createContext<PageContextValue | null>(null);

const defaultPageContext: PageContextValue = {
  slug: "/",
  path: "/",
  params: {},
  query: {},
  frontmatter: {},
};

export interface PageContextProviderProps {
  children: React.ReactNode;
  pageContext?: PageContextValue;
}

export function PageContextProvider({ children, pageContext }: PageContextProviderProps) {
  return React.createElement(PageContextContext.Provider, {
    value: pageContext || defaultPageContext,
    children,
  });
}

export function usePageContext(): PageContextValue {
  return React.useContext(PageContextContext) ?? defaultPageContext;
}

export default usePageContext;
