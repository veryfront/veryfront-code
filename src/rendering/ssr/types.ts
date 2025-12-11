
import type * as React from "react";

export interface MDXRenderOptions {
  frontmatter?: Record<string, unknown>;
  components?: Record<string, React.ComponentType<unknown>>;
  globals?: Record<string, unknown>;
  pageConfig?: Record<string, unknown>;
}

export interface MDXModule {
  default?: React.ComponentType<unknown>;
  MDXContent?: React.ComponentType<unknown>;
  frontmatter?: Record<string, unknown>;
}
