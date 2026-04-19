import type { LayoutItem } from "#veryfront/types";
import { extractRelativePath as extractRelativePathShared } from "#veryfront/utils/route-path-utils.ts";

const RENDERED_CSS_HASH_RE = /href="\/_vf\/css\/([a-z0-9-]{1,16})\.css"/i;

export function extractRenderedCssHash(html: string): string | undefined {
  return html.match(RENDERED_CSS_HASH_RE)?.[1];
}

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
): Record<string, Record<string, unknown>> {
  const serialized: Record<string, Record<string, unknown>> = {};

  for (const [layoutId, props] of layoutProps.entries()) {
    serialized[layoutId] = props;
  }

  return serialized;
}
