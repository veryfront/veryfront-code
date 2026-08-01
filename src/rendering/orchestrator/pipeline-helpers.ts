import type { LayoutItem } from "#veryfront/types";
import { extractRelativePath as extractRelativePathShared } from "#veryfront/utils/route-path-utils.ts";
import { isCSSContentHash } from "#veryfront/html/styles-builder/css-identity.ts";

const RENDERED_CSS_HASH_RE = /href="\/_vf\/css\/([a-f0-9]{64})\.css"/;
const RENDERED_RELEASE_ASSET_CSS_RE = /href="\/_vf\/assets\/([a-f0-9]{64})\.css"/i;

export function extractRenderedCssHash(html: string): string | undefined {
  const value = RENDERED_CSS_HASH_RE.exec(html)?.[1];
  return isCSSContentHash(value) ? value : undefined;
}

export function hasRenderedReleaseAssetCss(html: string): boolean {
  return RENDERED_RELEASE_ASSET_CSS_RE.test(html);
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
  projectDir: string,
): Record<string, Record<string, unknown>> {
  const serialized: Record<string, Record<string, unknown>> = {};

  for (const [layoutId, props] of layoutProps.entries()) {
    const key = extractRelativePathShared(layoutId, projectDir);
    serialized[key] = props;
  }

  return serialized;
}
