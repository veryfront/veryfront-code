import React from "react";
import { createContext, useContext } from "react";
import type { MDXComponents } from "../../types/index.js";

const MDXContext = createContext<MDXComponents>({});

export interface MDXProviderProps {
  components?: MDXComponents;
  children: React.ReactNode;
}

export function MDXProvider({
  components = {},
  children,
}: MDXProviderProps): React.ReactNode {
  return <MDXContext.Provider value={components}>{children}</MDXContext.Provider>;
}

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  const contextComponents = useContext(MDXContext);
  return { ...contextComponents, ...(components ?? {}) };
}
