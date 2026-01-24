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

  let liveLayout: MdxBundle | undefined;

  if (layoutName) {
    for (const entity of data.entities.values()) {
      if (!entity.isLayout || entity.slug !== layoutName) continue;

      const liveEntity = entity as LiveEntity;
      if (!liveEntity.compiledCode) continue;

      liveLayout = {
        compiledCode: liveEntity.compiledCode,
        frontmatter: entity.frontmatter ?? {},
        globals: liveEntity.globals,
      };
      break;
    }
  }

  const activeLayout = liveLayout ?? layout;

  if (!activeLayout) return <>{children}</>;

  return <LayoutComponent mdxBundle={activeLayout}>{children}</LayoutComponent>;
}
