import type React from "react";
import { useMemo } from "react";
import { mdxRenderer } from "@veryfront/transforms/mdx/index.ts";
import type { MdxBundle, MDXComponents, PageContext as TypedPageContext } from "@veryfront/types";
import { rendererLogger as logger } from "@veryfront/utils";

export type { MdxBundle } from "@veryfront/types";

export interface LayoutComponentProps {
  mdxBundle: MdxBundle;
  children: React.ReactNode;
  components?: MDXComponents;
  pageContext?: TypedPageContext;
}

export function LayoutComponent({
  mdxBundle,
  children,
  components = {
    /* empty */
  },
  pageContext,
}: LayoutComponentProps) {
  const element = useMemo(() => {
    try {
      return mdxRenderer.render(mdxBundle.compiledCode, {
        components,
        frontmatter: { ...(mdxBundle.frontmatter || {}), pageContext },
        globals: mdxBundle.globals,
        extractLayout: true,
        children,
      });
    } catch (error) {
      logger.error("[LayoutComponent] Render failed:", error);
      return <>{children}</>;
    }
  }, [
    mdxBundle.compiledCode,
    JSON.stringify(mdxBundle.frontmatter),
    components,
    children,
    JSON.stringify(pageContext),
  ]);

  if (!element) return <>{children}</>;
  return element as React.ReactElement;
}
