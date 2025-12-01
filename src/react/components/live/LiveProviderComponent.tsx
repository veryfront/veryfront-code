import type * as React from "react";
import type { Entity, MDXGlobals } from "@veryfront/types";
import type { MdxBundle } from "../LayoutComponent.tsx";
import { ProviderComponent } from "../ProviderComponent.tsx";
import { useLiveData } from "./LiveDataProvider.tsx";

interface LiveEntity extends Entity {
  compiledCode?: string;
  globals?: MDXGlobals;
}

export interface LiveProviderComponentProps {
  children: React.ReactNode;
  providers?: MdxBundle[];
}

export function LiveProviderComponent({ children, providers = [] }: LiveProviderComponentProps) {
  const { data } = useLiveData();

  const allProviders = [...providers];

  data.entities.forEach((entity, _id) => {
    const liveEntity = entity as LiveEntity;
    if (liveEntity.isProvider && liveEntity.compiledCode) {
      allProviders.push({
        compiledCode: liveEntity.compiledCode,
        frontmatter: liveEntity.frontmatter || {},
        globals: liveEntity.globals,
      });
    }
  });

  let content = children;

  for (const provider of allProviders.reverse()) {
    content = <ProviderComponent mdxBundle={provider}>{content}</ProviderComponent>;
  }

  return <>{content}</>;
}
