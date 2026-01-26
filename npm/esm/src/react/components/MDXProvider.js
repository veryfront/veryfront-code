import React from "react";
import { createContext, useContext } from "react";
const MDXContext = createContext({});
export function MDXProvider({ components = {}, children, }) {
    return React.createElement(MDXContext.Provider, { value: components }, children);
}
export function useMDXComponents(components) {
    const contextComponents = useContext(MDXContext);
    return { ...contextComponents, ...(components ?? {}) };
}
