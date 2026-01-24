import type * as React from "react";
import type { MdxBundle } from "../LayoutComponent.tsx";
import { ProviderComponent } from "../ProviderComponent.tsx";

export interface LiveProviderComponentProps {
  children: React.ReactNode;
  providers?: MdxBundle[];
}

/**
 * Wraps children with explicitly provided provider components.
 * Provider auto-discovery was removed - users should add providers in app.tsx.
 */
export function LiveProviderComponent({
  children,
  providers = [],
}: LiveProviderComponentProps): React.ReactElement {
  let content = children;

  for (let i = providers.length - 1; i >= 0; i--) {
    content = <ProviderComponent mdxBundle={providers[i]}>{content}</ProviderComponent>;
  }

  return <>{content}</>;
}
