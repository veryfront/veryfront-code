import type { Entity, MDXGlobals } from "#veryfront/types";
import type * as React from "react";
import type { MdxBundle } from "../LayoutComponent.tsx";
import { LayoutComponent } from "../LayoutComponent.tsx";
import { useLiveData } from "./LiveDataProvider.tsx";
import { usePageContext } from "./LivePageContextProvider.tsx";

interface LiveEntity extends Entity {
  compiledCode?: string;
  globals?: MDXGlobals;
}

export interface LiveLayoutComponentProps {
  children: React.ReactNode;
  layout?: MdxBundle;
}

export function LiveLayoutComponent({
  children,
  layout,
}: LiveLayoutComponentProps): React.ReactNode {
  const { data } = useLiveData();
  const pageContext = usePageContext();

  const layoutName = pageContext.frontmatter?.layout;
  if (!layoutName) {
    if (!layout) return <>{children}</>;
    return <LayoutComponent mdxBundle={layout}>{children}</LayoutComponent>;
  }

  for (const entity of data.entities.values()) {
    if (!entity.isLayout || entity.slug !== layoutName) continue;

    const liveEntity = entity as LiveEntity;
    if (!liveEntity.compiledCode) continue;

    const liveLayout: MdxBundle = {
      compiledCode: liveEntity.compiledCode,
      frontmatter: entity.frontmatter ?? {},
      globals: liveEntity.globals,
    };

    return <LayoutComponent mdxBundle={liveLayout}>{children}</LayoutComponent>;
  }

  if (!layout) return <>{children}</>;
  return <LayoutComponent mdxBundle={layout}>{children}</LayoutComponent>;
}
