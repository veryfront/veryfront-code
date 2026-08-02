import * as React from "react";
import type { MDXComponents, PageContext as TypedPageContext } from "#veryfront/types";
import type { MdxBundle } from "./LayoutComponent.tsx";
import { LayoutComponent } from "./LayoutComponent.tsx";
import { ProviderComponent } from "./ProviderComponent.tsx";

export { type MdxWrapperKind, MdxWrapperRenderError } from "./mdx-wrapper-error.ts";

export interface AppWrapperProps {
  children: React.ReactNode;
  providers?: MdxBundle[];
  layout?: MdxBundle;
  components?: MDXComponents;
  pageContext?: TypedPageContext;
}

export function AppWrapper({
  children,
  providers = [],
  layout,
  components = {},
  pageContext,
}: AppWrapperProps): React.ReactNode {
  let content = children;

  for (let i = providers.length - 1; i >= 0; i--) {
    const provider = providers[i];
    if (!provider) continue;

    content = (
      <ProviderComponent mdxBundle={provider} components={components}>
        {content}
      </ProviderComponent>
    );
  }

  if (!layout) return content;

  return (
    <LayoutComponent mdxBundle={layout} components={components} pageContext={pageContext}>
      {content}
    </LayoutComponent>
  );
}
