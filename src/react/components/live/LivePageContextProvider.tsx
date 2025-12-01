import type React from "react";
import { createContext, useContext } from "react";
import type { MDXFrontmatter, PageContext as TypedPageContext } from "@veryfront/types";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

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
}) {
  const context = pageContext || {
    slug: "",
    path: typeof window !== "undefined" ? globalThis.location.pathname : "/",
    params: {},
    query: typeof window !== "undefined"
      ? Object.fromEntries(new URLSearchParams(globalThis.location.search))
      : {},
    frontmatter: {},
  };

  return <PageContext.Provider value={context}>{children}</PageContext.Provider>;
}

export function usePageContext() {
  const context = useContext(PageContext);
  if (!context) {
    throw toError(createError({
      type: "config",
      message: "usePageContext must be used within LivePageContextProvider",
    }));
  }
  return context;
}
