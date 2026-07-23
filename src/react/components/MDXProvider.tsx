import * as React from "react";
import type { MDXComponents } from "#veryfront/types";

export type { MDXComponents } from "#veryfront/types";

const EMPTY_MDX_COMPONENTS = Object.freeze({}) as MDXComponents;
const MDXContext = React.createContext<MDXComponents>(EMPTY_MDX_COMPONENTS);

function mergeComponents(
  inherited: MDXComponents,
  overrides?: MDXComponents,
): MDXComponents {
  return { ...inherited, ...(overrides ?? {}) };
}

/** Props accepted by MDX provider. */
export interface MDXProviderProps {
  /** Component overrides applied within this provider. */
  components?: MDXComponents;
  /** MDX content rendered within the provider. */
  children?: React.ReactNode;
}

/** Provide inherited MDX component overrides to descendant content. */
export function MDXProvider({
  components,
  children,
}: MDXProviderProps): React.ReactElement {
  const inherited = React.useContext(MDXContext);
  const value = React.useMemo(
    () => mergeComponents(inherited, components),
    [inherited, components],
  );

  return <MDXContext.Provider value={value}>{children}</MDXContext.Provider>;
}

/** Return inherited MDX component overrides merged with local overrides. */
export function useMDXComponents(components?: MDXComponents): MDXComponents {
  const inherited = React.useContext(MDXContext);
  return React.useMemo(
    () => mergeComponents(inherited, components),
    [inherited, components],
  );
}
