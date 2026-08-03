import React, { createContext, useContext, useMemo } from "react";
import type { MDXComponents } from "#veryfront/types";

const MDXContext = createContext<MDXComponents>({});

/** Props accepted by {@link MDXProvider}. */
export interface MDXProviderProps {
  /** Component overrides merged over the nearest parent provider. */
  components?: MDXComponents;
  /** Compiled MDX or other React content that consumes the component map. */
  children: React.ReactNode;
}

/**
 * Provide component overrides to compiled MDX.
 *
 * Nested providers inherit outer entries. When the same key appears more than
 * once, the nearest provider wins.
 */
export function MDXProvider({
  components,
  children,
}: MDXProviderProps): React.ReactNode {
  const mergedComponents = useMDXComponents(components);
  return <MDXContext.Provider value={mergedComponents}>{children}</MDXContext.Provider>;
}

/**
 * Return the memoized effective component map.
 *
 * Optional local entries override the current provider without mutating it.
 */
export function useMDXComponents(components?: MDXComponents): MDXComponents {
  const contextComponents = useContext(MDXContext);
  return useMemo(
    () => ({ ...contextComponents, ...(components ?? {}) }),
    [contextComponents, components],
  );
}
