/**
 * Page context exports for veryfront/context
 * Provides page context for MDX pages
 */
import React from "react";

export interface MdxHeading {
  text: string;
  id: string;
  level: number;
}

export interface PageContextValue {
  slug: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  frontmatter: Record<string, unknown>;
  /** Headings extracted from MDX content for table of contents/sidebar navigation */
  headings: MdxHeading[];
  /** @deprecated Use `headings` instead. Alias for backwards compatibility. */
  mdxHeadings: MdxHeading[];
}

const PageContextContext = React.createContext<PageContextValue | null>(null);

const defaultPageContext: PageContextValue = {
  slug: "/",
  path: "/",
  params: {},
  query: {},
  frontmatter: {},
  headings: [],
  mdxHeadings: [],
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
