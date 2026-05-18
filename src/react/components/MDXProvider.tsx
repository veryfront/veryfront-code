import React, { createContext, useContext } from "react";
import type { MDXComponents } from "#veryfront/types";

const MDXContext = createContext<MDXComponents>({});

/** Props accepted by MDX provider. */
export interface MDXProviderProps {
  components?: MDXComponents;
  children: React.ReactNode;
}

/** Render MDX provider. */
export function MDXProvider({
  components = {},
  children,
}: MDXProviderProps): React.ReactNode {
  return <MDXContext.Provider value={components}>{children}</MDXContext.Provider>;
}

/** React hook for mdxcomponents. */
export function useMDXComponents(components?: MDXComponents): MDXComponents {
  const contextComponents = useContext(MDXContext);
  return { ...contextComponents, ...(components ?? {}) };
}
