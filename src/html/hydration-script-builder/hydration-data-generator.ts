import type { ComponentProps } from "@veryfront/types";
import type { HTMLGenerationOptions } from "../types.ts";
import type { HydrationDataStructure } from "./types.ts";

export function generateHydrationData(
  slug: string,
  params: Record<string, string | string[]>,
  props: ComponentProps,
  options: HTMLGenerationOptions,
): string {
  const data: HydrationDataStructure = {
    slug: slug || "",
    props: props || {},
    params: params || {},
    layouts: (options.nestedLayouts || [])
      .map((l) => ({
        kind: l.kind,
        path: l.path || l.componentPath || "",
      }))
      .filter((l) => l.path !== ""),
    providers: options.providerPaths || [],
    appPath: options.appPath,
    pagePath: options.pagePath,
  };

  return JSON.stringify(data, null, 2);
}
