import type { LayoutItem } from "#veryfront/types";
import { extractRelativePath as extractRelativePathShared } from "#veryfront/utils/route-path-utils.ts";

export function serializeLayouts(
  nestedLayouts: LayoutItem[],
  projectDir: string,
): Array<{ kind: LayoutItem["kind"]; path: string }> {
  return nestedLayouts
    .filter((layout: LayoutItem) => layout.componentPath || layout.path)
    .map((layout: LayoutItem) => ({
      kind: layout.kind,
      path: extractRelativePathShared(
        layout.componentPath || layout.path || "",
        projectDir,
      ),
    }));
}

export function serializeLayoutProps(
  layoutProps: Map<string, Record<string, unknown>>,
  projectDir: string,
): Record<string, Record<string, unknown>> {
  const serialized: Record<string, Record<string, unknown>> = {};

  for (const [layoutId, props] of layoutProps.entries()) {
    const key = extractRelativePathShared(layoutId, projectDir);
    serialized[key] = props;
  }

  return serialized;
}
