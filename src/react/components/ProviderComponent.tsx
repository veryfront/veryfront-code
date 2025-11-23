import type * as React from "react";
import { useMemo } from "react";
import { mdxRenderer } from "@veryfront/transforms/mdx/index.ts";
import type { MDXComponents } from "@veryfront/types";
import type { MdxBundle } from "./LayoutComponent.tsx";
import { rendererLogger as logger } from "@veryfront/utils";

export interface ProviderComponentProps {
  mdxBundle: MdxBundle;
  children: React.ReactNode;
  components?: MDXComponents;
}

export function ProviderComponent({
  mdxBundle,
  children,
  components = {
    /* empty */
  },
}: ProviderComponentProps) {
  const element = useMemo(() => {
    try {
      return mdxRenderer.render(mdxBundle.compiledCode, {
        components,
        frontmatter: mdxBundle.frontmatter,
        globals: mdxBundle.globals,
        extractLayout: true,
        children,
      });
    } catch (error) {
      logger.error("[ProviderComponent] Render failed:", error);
      return <>{children}</>;
    }
  }, [mdxBundle.compiledCode, JSON.stringify(mdxBundle.frontmatter), components, children]);

  if (!element) return <>{children}</>;
  return element as React.ReactElement;
}
