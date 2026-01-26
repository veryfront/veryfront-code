import "../../../_dnt.polyfills.js";
import "../../../_dnt.polyfills.js";
import React from "react";
const defaultPageContext = {
    slug: "/",
    path: "/",
    params: {},
    query: {},
    frontmatter: {},
    headings: [],
    mdxHeadings: [],
};
const PageContextContext = React.createContext(defaultPageContext);
export function PageContextProvider({ children, pageContext, }) {
    return React.createElement(PageContextContext.Provider, {
        value: pageContext ?? defaultPageContext,
        children,
    });
}
export function usePageContext() {
    return React.useContext(PageContextContext);
}
export default usePageContext;
