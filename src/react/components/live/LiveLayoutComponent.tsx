import type { Entity, MDXGlobals } from "@veryfront/types";
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

export function LiveLayoutComponent({ children, layout }: LiveLayoutComponentProps) {
  const { data } = useLiveData();
  const pageContext = usePageContext();

  const layoutName = pageContext.frontmatter?.layout;

  let liveLayout: MdxBundle | undefined;

  if (layoutName) {
    data.entities.forEach((entity, _id) => {
      if (entity.isLayout && entity.slug === layoutName) {
        const liveEntity = entity as LiveEntity;
        if (liveEntity.compiledCode) {
          liveLayout = {
            compiledCode: liveEntity.compiledCode,
            frontmatter: entity.frontmatter ||
              {
                /* empty */
              },
            globals: liveEntity.globals,
          };
        }
      }
    });
  }

  const activeLayout = liveLayout || layout;

  if (!activeLayout) {
    return <>{children}</>;
  }

  return <LayoutComponent mdxBundle={activeLayout}>{children}</LayoutComponent>;
}
