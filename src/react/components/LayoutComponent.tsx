import type React from "react";
import { useMemo, useRef } from "react";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { MdxBundle, MDXComponents, PageContext as TypedPageContext } from "#veryfront/types";
import { rendererLogger as logger } from "#veryfront/utils";

export type { MdxBundle } from "#veryfront/types";

interface LayoutComponentProps {
  mdxBundle: MdxBundle;
  children: React.ReactNode;
  components?: MDXComponents;
  pageContext?: TypedPageContext;
}

function useStableObject<T>(obj: T): T {
  const ref = useRef(obj);
  const prevSerialized = useRef(JSON.stringify(obj));

  const serialized = JSON.stringify(obj);
  if (prevSerialized.current === serialized) return ref.current;

  ref.current = obj;
  prevSerialized.current = serialized;
  return ref.current;
}

export function LayoutComponent({
  mdxBundle,
  children,
  components = {},
  pageContext,
}: LayoutComponentProps): React.ReactElement {
  const stableFrontmatter = useStableObject(mdxBundle.frontmatter);
  const stablePageContext = useStableObject(pageContext);

  const fallback = <>{children}</>;

  const element = useMemo(() => {
    try {
      return mdxRenderer.render(mdxBundle.compiledCode, {
        components,
        frontmatter: { ...(stableFrontmatter ?? {}), pageContext: stablePageContext },
        globals: mdxBundle.globals,
        extractLayout: true,
        children,
      });
    } catch (error) {
      logger.error("[LayoutComponent] Render failed:", error);
      return fallback;
    }
  }, [
    mdxBundle.compiledCode,
    mdxBundle.globals,
    components,
    children,
    stableFrontmatter,
    stablePageContext,
  ]);

  return element || fallback;
}
