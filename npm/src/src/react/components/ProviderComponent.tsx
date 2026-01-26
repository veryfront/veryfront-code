import type * as React from "react";
import { useMemo, useRef } from "react";
import { mdxRenderer } from "../../transforms/mdx/index.js";
import type { MDXComponents } from "../../types/index.js";
import type { MdxBundle } from "./LayoutComponent.js";
import { rendererLogger as logger } from "../../utils/index.js";

export interface ProviderComponentProps {
  mdxBundle: MdxBundle;
  children: React.ReactNode;
  components?: MDXComponents;
}

function useStableFrontmatter(
  frontmatter: MdxBundle["frontmatter"],
): MdxBundle["frontmatter"] {
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
}: ProviderComponentProps): React.ReactElement {
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
      return null;
    }
  }, [
    mdxBundle.compiledCode,
    stableFrontmatter,
    components,
    mdxBundle.globals,
    children,
  ]);

  return element ?? <>{children}</>;
}
