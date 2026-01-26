import * as React from "react";
import type { MDXComponents, PageContext as TypedPageContext } from "../../types/index.js";
import type { MdxBundle } from "./LayoutComponent.js";
import { LayoutComponent } from "./LayoutComponent.js";
import { ProviderComponent } from "./ProviderComponent.js";

export interface AppWrapperProps {
  children: React.ReactNode;
  providers?: MdxBundle[];
  layout?: MdxBundle;
  components?: MDXComponents;
  mode?: string;
  studioEnabled?: boolean;
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

  if (layout) {
    content = (
      <LayoutComponent mdxBundle={layout} components={components} pageContext={pageContext}>
        {content}
      </LayoutComponent>
    );
  }

  for (let i = providers.length - 1; i >= 0; i--) {
    const provider = providers[i];
    if (!provider) continue;
    content = (
      <ProviderComponent mdxBundle={provider} components={components}>
        {content}
      </ProviderComponent>
    );
  }

  return content;
}
