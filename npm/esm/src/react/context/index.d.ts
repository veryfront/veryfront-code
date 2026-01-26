import "../../../_dnt.polyfills.js";
import "../../../_dnt.polyfills.js";
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
export interface PageContextProviderProps {
    children: React.ReactNode;
    pageContext?: PageContextValue;
}
export declare function PageContextProvider({ children, pageContext, }: PageContextProviderProps): React.ReactElement;
export declare function usePageContext(): PageContextValue;
export default usePageContext;
//# sourceMappingURL=index.d.ts.map