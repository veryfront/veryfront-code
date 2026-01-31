import type React from "react";
import { createContext, useContext } from "react";
import type { MDXFrontmatter, PageContext as TypedPageContext } from "#veryfront/types";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";

interface PageContext extends Omit<TypedPageContext, "frontmatter"> {
  frontmatter?: MDXFrontmatter;
}

const PageContext = createContext<PageContext | null>(null);

export function LivePageContextProvider({
  children,
  pageContext,
}: {
  children: React.ReactNode;
  pageContext?: TypedPageContext;
}): React.ReactElement {
  if (pageContext) {
    return <PageContext.Provider value={pageContext}>{children}</PageContext.Provider>;
  }

  const inBrowser = isBrowserEnvironment();

  const context: PageContext = {
    slug: "",
    path: inBrowser ? globalThis.location.pathname : "/",
    params: {},
    query: inBrowser ? Object.fromEntries(new URLSearchParams(globalThis.location.search)) : {},
    frontmatter: {},
  };

  return <PageContext.Provider value={context}>{children}</PageContext.Provider>;
}

export function usePageContext(): PageContext {
  const context = useContext(PageContext);

  if (context) return context;

  throw toError(
    createError({
      type: "config",
      message: "usePageContext must be used within LivePageContextProvider",
    }),
  );
}
