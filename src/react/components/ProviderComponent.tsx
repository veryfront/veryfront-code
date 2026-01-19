import type * as React from "react";
import { useMemo, useRef } from "react";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { MDXComponents } from "#veryfront/types";
import type { MdxBundle } from "./LayoutComponent.tsx";
import { rendererLogger as logger } from "#veryfront/utils";

export interface ProviderComponentProps {
  mdxBundle: MdxBundle;
  children: React.ReactNode;
  components?: MDXComponents;
}

function useStableFrontmatter(frontmatter: MdxBundle["frontmatter"]): MdxBundle["frontmatter"] {
  const ref = useRef(frontmatter);
  const serialized = JSON.stringify(frontmatter);
  const prevSerialized = useRef(serialized);

  if (prevSerialized.current !== serialized) {
    ref.current = frontmatter;
    prevSerialized.current = serialized;
  }

  return ref.current;
}

export function ProviderComponent({
  mdxBundle,
  children,
  components = {},
}: ProviderComponentProps) {
  const stableFrontmatter = useStableFrontmatter(mdxBundle.frontmatter);

  const element = useMemo(() => {
    try {
      return mdxRenderer.render(mdxBundle.compiledCode, {
        components,
        frontmatter: stableFrontmatter,
        globals: mdxBundle.globals,
        extractLayout: true,
        children,
      });
    } catch (error) {
      logger.error("[ProviderComponent] Render failed:", error);
      return <>{children}</>;
    }
  }, [mdxBundle.compiledCode, stableFrontmatter, components, children, mdxBundle.globals]);

  if (!element) return <>{children}</>;
  return element as React.ReactElement;
}
