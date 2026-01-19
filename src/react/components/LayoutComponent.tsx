import type React from "react";
import { useMemo, useRef } from "react";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { MdxBundle, MDXComponents, PageContext as TypedPageContext } from "#veryfront/types";
import { rendererLogger as logger } from "#veryfront/utils";

export type { MdxBundle } from "#veryfront/types";

export interface LayoutComponentProps {
  mdxBundle: MdxBundle;
  children: React.ReactNode;
  components?: MDXComponents;
  pageContext?: TypedPageContext;
}

function useStableObject<T>(obj: T): T {
  const ref = useRef(obj);
  const serialized = JSON.stringify(obj);
  const prevSerialized = useRef(serialized);

  if (prevSerialized.current !== serialized) {
    ref.current = obj;
    prevSerialized.current = serialized;
  }

  return ref.current;
}

export function LayoutComponent({
  mdxBundle,
  children,
  components = {},
  pageContext,
}: LayoutComponentProps) {
  const stableFrontmatter = useStableObject(mdxBundle.frontmatter);
  const stablePageContext = useStableObject(pageContext);

  const element = useMemo(() => {
    try {
      return mdxRenderer.render(mdxBundle.compiledCode, {
        components,
        frontmatter: { ...(stableFrontmatter || {}), pageContext: stablePageContext },
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
    stableFrontmatter,
    components,
    children,
    stablePageContext,
    mdxBundle.globals,
  ]);

  if (!element) return <>{children}</>;
  return element as React.ReactElement;
}
