import type React from "react";
import { createContext, useContext } from "react";
import type { MDXComponents } from "@veryfront/types";

const MDXContext = createContext<MDXComponents>({
  /* empty */
});

export interface MDXProviderProps {
  components?: MDXComponents;
  children: React.ReactNode;
}

export function MDXProvider({
  components = {
    /* empty */
  },
  children,
}: MDXProviderProps) {
  return <MDXContext.Provider value={components}>{children}</MDXContext.Provider>;
}

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  const contextComponents = useContext(MDXContext);
  return { ...contextComponents, ...components };
}
