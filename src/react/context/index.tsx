/**
 * Access route params, page data, and MDX frontmatter.
 *
 * @module context
 *
 * @example
 * ```tsx
 * import { usePageContext } from "veryfront/context";
 *
 * function TableOfContents() {
 *   const { headings, frontmatter } = usePageContext();
 *   return (
 *     <ul>
 *       {headings.map((h) => (
 *         <li key={h.id}>
 *           <a href={`#${h.id}`}>{h.text}</a>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
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

const defaultPageContext: PageContextValue = {
  slug: "/",
  path: "/",
  params: {},
  query: {},
  frontmatter: {},
  headings: [],
  mdxHeadings: [],
};

const PageContextContext = React.createContext(defaultPageContext);

export interface PageContextProviderProps {
  children: React.ReactNode;
  pageContext?: PageContextValue;
}

export function PageContextProvider({
  children,
  pageContext,
}: PageContextProviderProps): React.ReactElement {
  return (
    <PageContextContext.Provider value={pageContext ?? defaultPageContext}>
      {children}
    </PageContextContext.Provider>
  );
}

export function usePageContext(): PageContextValue {
  return React.useContext(PageContextContext);
}
